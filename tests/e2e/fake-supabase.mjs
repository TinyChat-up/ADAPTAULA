// SOLO PARA PRUEBAS E2E LOCALES. Nunca se despliega ni se usa en producción.
//
// Imita el mínimo de Supabase (Auth + PostgREST + Storage) que usa la app, pero sobre PGlite con las
// migraciones REALES del proyecto: RLS, permisos por columna, triggers y funciones SQL son los de verdad.
// Lo que NO imita: GoTrue (contraseñas simples, sin emails), el gateway ni el servicio real de Storage.
// Por eso no sustituye a la prueba contra un proyecto real (docs/SUPABASE_TESTING.md).
import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 54399);
const SERVICE_KEY = process.env.FAKE_SERVICE_KEY ?? "sb_secret_fakefakefakefakefake";

// ---------------------------------------------------------------------------
// Base de datos
// ---------------------------------------------------------------------------

const db = new PGlite();
await db.exec(readFileSync(path.join(ROOT, "tests/support/supabase-stub.sql"), "utf8"));
for (const file of readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(path.join(ROOT, "supabase/migrations", file), "utf8"));
}
await db.exec(readFileSync(path.join(ROOT, "supabase/seed.sql"), "utf8"));

let queue = Promise.resolve();
/** PGlite tiene una sola conexión: las peticiones se serializan. */
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

/** Ejecuta `fn` con el rol de Postgres y el `sub` del JWT de la petición. */
async function withRole(auth, fn) {
  return serial(async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [auth.sub ?? ""]);
    await db.exec(`set role ${auth.role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }
  });
}

const columnTypes = new Map();
/** Dentro del lock y sin rol restringido: information_schema solo muestra las columnas que el rol actual puede ver. */
async function typesOf(table) {
  if (!columnTypes.has(table)) {
    const { rows } = await serial(() =>
      db.query("select column_name, data_type, udt_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table]),
    );
    columnTypes.set(table, new Map(rows.map((r) => [r.column_name, r])));
  }
  return columnTypes.get(table);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (value) => {
  if (!IDENT.test(value)) throw Object.assign(new Error(`identificador no válido: ${value}`), { code: "PGRST100", status: 400 });
  return `"${value}"`;
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const toJson = (value) => JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v));

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "content-range,etag",
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const pgArray = (values) => `{${values.map((v) => `"${String(v).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;

function statusForPgError(error) {
  const code = error.code ?? "";
  if (code === "42501") return 403;
  if (code === "23505" || code === "23503") return 409;
  if (code === "42P01") return 404;
  return 400;
}

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------

const users = new Map(); // email -> { id, email, password, name }
const byId = new Map();

const authUser = (u) => ({
  id: u.id,
  aud: "authenticated",
  role: "authenticated",
  email: u.email,
  email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: u.name },
  created_at: new Date().toISOString(),
});

function session(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = { sub: user.id, email: user.email, aud: "authenticated", role: "authenticated", exp, iat: exp - 3600 };
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.fake`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `refresh-${user.id}`,
    user: authUser(user),
  };
}

function authOf(req) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (token === SERVICE_KEY) return { role: "service_role", sub: null };
  const parts = token.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      if (payload.role === "authenticated" && byId.has(payload.sub) && payload.exp * 1000 > Date.now()) {
        return { role: "authenticated", sub: payload.sub };
      }
    } catch {
      /* cae a anon */
    }
  }
  return { role: "anon", sub: null };
}

// ---------------------------------------------------------------------------
// PostgREST (subconjunto)
// ---------------------------------------------------------------------------

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

async function selectList(table, select, alias = "t") {
  const items = select ? splitTopLevel(select) : ["*"];
  const sql = [];
  for (const item of items) {
    const embed = /^([a-z_]+)\((.*)\)$/.exec(item);
    if (embed) {
      const [, rel, inner] = embed;
      const { rows } = await db.query(
        `select a.attname as fk, ra.attname as ref from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
          where c.contype = 'f' and c.conrelid = $1::regclass and c.confrelid = $2::regclass limit 1`,
        [`public.${table}`, `public.${rel}`],
      );
      if (!rows[0]) throw Object.assign(new Error(`sin relación entre ${table} y ${rel}`), { code: "PGRST200", status: 400 });
      const innerCols = splitTopLevel(inner).map((c) => (c === "*" ? "r.*" : `r.${ident(c)}`)).join(", ");
      sql.push(`(select to_jsonb(x) from (select ${innerCols} from public.${ident(rel)} r where r.${ident(rows[0].ref)} = ${alias}.${ident(rows[0].fk)}) x) as ${ident(rel)}`);
    } else if (item === "*") sql.push(`${alias}.*`);
    else sql.push(`${alias}.${ident(item.split(":").pop().split("::")[0])}`);
  }
  return sql.join(", ");
}

function buildFilters(params, values) {
  const where = [];
  for (const [key, raw] of params) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(key)) continue;
    let op = raw;
    let negate = false;
    if (op.startsWith("not.")) {
      negate = true;
      op = op.slice(4);
    }
    const dot = op.indexOf(".");
    const kind = op.slice(0, dot);
    const arg = op.slice(dot + 1);
    const col = `t.${ident(key)}`;
    let clause;
    if (kind === "is") clause = `${col} is ${arg === "null" ? "null" : arg === "true" ? "true" : arg === "false" ? "false" : "unknown"}`;
    else if (kind === "in") {
      const items = arg.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
      values.push(items);
      clause = `${col}::text = any($${values.length}::text[])`;
    } else {
      const sqlOp = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" }[kind];
      if (!sqlOp) throw Object.assign(new Error(`operador no soportado: ${kind}`), { code: "PGRST100", status: 400 });
      values.push(kind === "like" || kind === "ilike" ? arg.replaceAll("*", "%") : arg);
      clause = `${col} ${sqlOp} $${values.length}`;
    }
    where.push(negate ? `not (${clause})` : clause);
  }
  return where.length ? `where ${where.join(" and ")}` : "";
}

const orderBy = (order) =>
  order
    ? `order by ${order
        .split(",")
        .map((o) => {
          const [col, dir] = o.split(".");
          return `t.${ident(col)} ${dir === "desc" ? "desc" : "asc"}`;
        })
        .join(", ")}`
    : "";

function encodeValue(types, column, value) {
  const type = types.get(column);
  if (!type) throw Object.assign(new Error(`columna desconocida: ${column}`), { code: "PGRST204", status: 400 });
  if (value === null) return { sql: "null", param: undefined };
  if (type.data_type === "jsonb" || type.data_type === "json") return { sql: "?::jsonb", param: JSON.stringify(value) };
  if (type.data_type === "ARRAY") return { sql: `?::${type.udt_name.replace(/^_/, "")}[]`, param: pgArray(value) };
  return { sql: "?", param: value };
}

async function handleRestWithBody(req, res, url, auth, rawBody) {
  const table = url.pathname.replace("/rest/v1/", "");
  const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const prefer = req.headers.prefer ?? "";
  const wantsRows = prefer.includes("return=representation");
  const wantsCount = prefer.includes("count=");
  const send = (status, data, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...CORS, ...headers });
    res.end(data === undefined || req.method === "HEAD" ? "" : toJson(data));
  };
  const respondRows = (rows, status = 200, extra = {}) =>
    wantsObject
      ? rows.length === 1
        ? send(status, rows[0], extra)
        : send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows` })
      : send(status, rows, extra);

  try {
    if (table.startsWith("rpc/")) {
      const fn = ident(table.slice(4));
      const args = rawBody.length ? JSON.parse(rawBody.toString()) : {};
      const keys = Object.keys(args);
      const sql = `select public.${fn}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")}) as r`;
      const { rows } = await withRole(auth, () => db.query(sql, keys.map((k) => args[k])));
      return send(200, rows[0]?.r ?? null);
    }

    ident(table);
    const types = await typesOf(table);
    const params = [...url.searchParams.entries()];
    const select = url.searchParams.get("select");

    if (req.method === "GET" || req.method === "HEAD") {
      const values = [];
      const where = buildFilters(params, values);
      const cols = await selectList(table, select);
      const limit = url.searchParams.get("limit");
      const offset = url.searchParams.get("offset");
      const sql = `select ${cols} from public.${ident(table)} t ${where} ${orderBy(url.searchParams.get("order"))} ${limit ? `limit ${Number(limit)}` : ""} ${offset ? `offset ${Number(offset)}` : ""}`;
      const result = await withRole(auth, async () => {
        const rows = (await db.query(sql, values)).rows;
        const total = wantsCount ? (await db.query(`select count(*)::int as n from public.${ident(table)} t ${where}`, values)).rows[0].n : null;
        return { rows, total };
      });
      const range = wantsCount ? { "content-range": result.rows.length ? `0-${result.rows.length - 1}/${result.total}` : `*/${result.total}` } : {};
      return respondRows(result.rows, 200, range);
    }

    if (req.method === "POST") {
      const body = JSON.parse(rawBody.toString() || "{}");
      const list = Array.isArray(body) ? body : [body];
      const outRows = await withRole(auth, async () => {
        const out = [];
        for (const item of list) {
          const keys = Object.keys(item);
          const values = [];
          const placeholders = keys.map((k) => {
            const enc = encodeValue(types, k, item[k]);
            if (enc.sql === "null") return "null";
            values.push(enc.param);
            return enc.sql.replace("?", `$${values.length}`);
          });
          const cols = await selectList(table, select, "ins");
          const insert = keys.length
            ? `insert into public.${ident(table)} (${keys.map(ident).join(", ")}) values (${placeholders.join(", ")})`
            : `insert into public.${ident(table)} default values`;
          const { rows } = await db.query(`with ins as (${insert} returning *) select ${cols} from ins`, values);
          out.push(...rows);
        }
        return out;
      });
      return wantsRows ? respondRows(outRows, 201) : send(201, undefined);
    }

    if (req.method === "PATCH" || req.method === "DELETE") {
      const values = [];
      let set = "";
      if (req.method === "PATCH") {
        const body = JSON.parse(rawBody.toString() || "{}");
        set =
          "set " +
          Object.keys(body)
            .map((k) => {
              const enc = encodeValue(types, k, body[k]);
              if (enc.sql === "null") return `${ident(k)} = null`;
              values.push(enc.param);
              return `${ident(k)} = ${enc.sql.replace("?", `$${values.length}`)}`;
            })
            .join(", ");
      }
      const where = buildFilters(params, values);
      const cols = await selectList(table, select, "m");
      const statement =
        req.method === "PATCH" ? `update public.${ident(table)} t ${set} ${where} returning t.*` : `delete from public.${ident(table)} t ${where} returning t.*`;
      const { rows } = await withRole(auth, () => db.query(`with m as (${statement}) select ${cols} from m`, values));
      return wantsRows ? respondRows(rows) : send(204, undefined);
    }
    return send(405, { message: "método no soportado" });
  } catch (error) {
    return send(error.status ?? statusForPgError(error), { code: error.code ?? "PGRST000", message: error.message, details: error.detail ?? null, hint: null });
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const objects = new Map(); // "bucket/path" -> { bytes, mime }
const uploadTokens = new Map(); // token -> { bucket, path }
const readTokens = new Map(); // token -> { bucket, path, expires }

function parseMultipart(body, contentType) {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    const headers = part.subarray(0, split).toString();
    if (/name=""/.test(headers) || /filename=/.test(headers)) {
      return { bytes: part.subarray(split + 4), mime: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? null };
    }
    start = next;
  }
  return null;
}

async function handleStorage(req, res, url, auth, rawBody) {
  const rest = url.pathname.replace("/storage/v1/", "");
  const json = (status, data) => {
    res.writeHead(status, { "content-type": "application/json", ...CORS });
    res.end(toJson(data));
  };
  const notFound = () => json(404, { statusCode: "404", error: "not_found", message: "Object not found" });
  const visible = (bucket, name) => withRole(auth, async () => (await db.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).rows.length > 0);
  const send = (entry, extraHeaders = {}) => {
    res.writeHead(200, { "content-type": entry.mime ?? "application/octet-stream", ...extraHeaders, ...CORS });
    res.end(entry.bytes);
  };

  // POST /object/upload/sign/<bucket>/<path>  → URL firmada de subida (solo service role)
  let m = /^object\/upload\/sign\/([^/]+)\/(.+)$/.exec(rest);
  if (m && req.method === "POST") {
    if (auth.role !== "service_role") return json(403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
    const [, bucket, name] = m;
    const token = randomUUID();
    uploadTokens.set(token, { bucket, path: decodeURIComponent(name) });
    return json(200, { url: `/object/upload/sign/${bucket}/${name}?token=${token}` });
  }
  // PUT /object/upload/sign/<bucket>/<path>?token=…  → subida con el token
  if (m && req.method === "PUT") {
    const [, bucket, name] = m;
    const entry = uploadTokens.get(url.searchParams.get("token") ?? "");
    if (!entry || entry.bucket !== bucket || entry.path !== decodeURIComponent(name)) return json(403, { statusCode: "403", error: "Unauthorized", message: "invalid token" });
    const multipart = parseMultipart(rawBody, req.headers["content-type"] ?? "");
    const bytes = multipart ? multipart.bytes : rawBody;
    const mime = multipart?.mime ?? req.headers["content-type"] ?? "application/octet-stream";
    const bucketRow = (await serial(() => db.query("select file_size_limit, allowed_mime_types from storage.buckets where id = $1", [bucket]))).rows[0];
    if (!bucketRow) return json(404, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    if (bucketRow.file_size_limit && bytes.length > Number(bucketRow.file_size_limit)) return json(413, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
    if (bucketRow.allowed_mime_types && !bucketRow.allowed_mime_types.includes(mime.split(";")[0])) return json(415, { statusCode: "415", error: "invalid_mime_type", message: `mime type ${mime} is not supported` });
    objects.set(`${bucket}/${entry.path}`, { bytes, mime });
    await serial(() => db.query("insert into storage.objects (bucket_id, name) values ($1, $2) on conflict do nothing", [bucket, entry.path]));
    uploadTokens.delete(url.searchParams.get("token"));
    return json(200, { Key: `${bucket}/${entry.path}` });
  }
  // POST /object/sign/<bucket>/<path>  → URL de lectura (requiere poder leer el objeto)
  m = /^object\/sign\/([^/]+)\/(.+)$/.exec(rest);
  if (m && req.method === "POST") {
    const [, bucket, name] = m;
    const path = decodeURIComponent(name);
    if (!(await visible(bucket, path))) return notFound();
    const token = randomUUID();
    const { expiresIn = 60 } = rawBody.length ? JSON.parse(rawBody.toString()) : {};
    readTokens.set(token, { bucket, path, expires: Date.now() + expiresIn * 1000 });
    return json(200, { signedURL: `/object/sign/${bucket}/${name}?token=${token}` });
  }
  // GET /object/sign/<bucket>/<path>?token=…
  if (m && req.method === "GET") {
    const entry = readTokens.get(url.searchParams.get("token") ?? "");
    if (!entry || entry.expires < Date.now() || entry.bucket !== m[1]) return json(400, { statusCode: "400", error: "InvalidJWT", message: "exp claim timestamp check failed" });
    const stored = objects.get(`${entry.bucket}/${entry.path}`);
    if (!stored) return notFound();
    return send(stored, url.searchParams.has("download") ? { "content-disposition": "attachment" } : {});
  }
  // DELETE /object/<bucket>  { prefixes: [...] }
  m = /^object\/([^/]+)$/.exec(rest);
  if (m && req.method === "DELETE") {
    const bucket = m[1];
    const { prefixes = [] } = rawBody.length ? JSON.parse(rawBody.toString()) : {};
    const removed = await withRole(auth, async () => {
      const out = [];
      for (const name of prefixes) {
        const { rows } = await db.query("delete from storage.objects where bucket_id = $1 and name = $2 returning name", [bucket, name]);
        if (rows.length) {
          objects.delete(`${bucket}/${name}`);
          out.push({ name, bucket_id: bucket });
        }
      }
      return out;
    });
    return json(200, removed);
  }
  // GET /object/[authenticated/]<bucket>/<path>  → descarga autenticada
  m = /^object\/(?:authenticated\/)?([^/]+)\/(.+)$/.exec(rest);
  if (m && req.method === "GET") {
    const [, bucket, name] = m;
    const path = decodeURIComponent(name);
    if (!(await visible(bucket, path))) return notFound();
    const stored = objects.get(`${bucket}/${path}`);
    return stored ? send(stored) : notFound();
  }
  return json(404, { statusCode: "404", error: "not_found", message: `fake-supabase storage: ${req.method} ${url.pathname}` });
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

http
  .createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const auth = authOf(req);
    const rawBody = await readBody(req);
    const json = (status, data, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...CORS, ...headers });
      res.end(data === undefined ? "" : toJson(data));
    };

    try {
      if (url.pathname.startsWith("/rest/v1/")) return await handleRestWithBody(req, res, url, auth, rawBody);
      if (url.pathname.startsWith("/storage/v1/")) return await handleStorage(req, res, url, auth, rawBody);

      if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
        const { email, password, data } = JSON.parse(rawBody.toString());
        if (users.has(email)) return json(422, { code: "user_already_exists", msg: "User already registered" });
        const name = data?.full_name ?? "";
        // El trigger real on_auth_user_created crea perfil, workspace y membresía.
        const { rows } = await serial(() =>
          db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, JSON.stringify({ full_name: name })]),
        );
        const user = { id: rows[0].id, email, password, name };
        users.set(email, user);
        byId.set(user.id, user);
        return json(200, session(user));
      }
      if (url.pathname === "/auth/v1/token" && req.method === "POST") {
        const body = JSON.parse(rawBody.toString() || "{}");
        if (url.searchParams.get("grant_type") === "refresh_token") {
          const user = byId.get(String(body.refresh_token ?? "").replace("refresh-", ""));
          return user ? json(200, session(user)) : json(400, { code: "invalid_grant", msg: "Invalid Refresh Token" });
        }
        const user = users.get(body.email);
        return user && user.password === body.password ? json(200, session(user)) : json(400, { code: "invalid_credentials", msg: "Invalid login credentials" });
      }
      if (url.pathname === "/auth/v1/user") {
        const user = byId.get(auth.sub);
        if (!user) return json(401, { code: "bad_jwt", msg: "invalid JWT" });
        if (req.method === "PUT") {
          const body = JSON.parse(rawBody.toString() || "{}");
          if (body.password) user.password = body.password;
        }
        return json(200, authUser(user));
      }
      // API de administración de usuarios (solo con la clave de servicio), la usa la suite RLS.
      if (url.pathname === "/auth/v1/admin/users" && req.method === "POST") {
        if (auth.role !== "service_role") return json(403, { code: "not_admin", msg: "User not allowed" });
        const { email, password, user_metadata } = JSON.parse(rawBody.toString());
        const name = user_metadata?.full_name ?? "";
        const { rows } = await serial(() => db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, JSON.stringify({ full_name: name })]));
        const user = { id: rows[0].id, email, password, name };
        users.set(email, user);
        byId.set(user.id, user);
        return json(200, authUser(user));
      }
      if (url.pathname === "/auth/v1/admin/users" && req.method === "GET") {
        if (auth.role !== "service_role") return json(403, { code: "not_admin", msg: "User not allowed" });
        const all = [...byId.values()].map(authUser);
        return json(200, { users: all, aud: "authenticated" }, { "x-total-count": String(all.length) });
      }
      const adminUser = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (adminUser && req.method === "DELETE") {
        if (auth.role !== "service_role") return json(403, { code: "not_admin", msg: "User not allowed" });
        try {
          await serial(() => db.query("delete from auth.users where id = $1", [adminUser[1]]));
        } catch (error) {
          return json(500, { code: "unexpected_failure", msg: String(error.message) });
        }
        const gone = byId.get(adminUser[1]);
        if (gone) {
          users.delete(gone.email);
          byId.delete(gone.id);
        }
        return json(200, {});
      }
      if (url.pathname === "/auth/v1/logout") return json(204, undefined);
      if (url.pathname === "/auth/v1/recover" || url.pathname === "/auth/v1/otp") return json(200, {});
      if (url.pathname === "/health") return json(200, { ok: true });
      return json(404, { message: `fake-supabase: ${req.method} ${url.pathname}` });
    } catch (error) {
      console.error("[fake-supabase]", error);
      return json(500, { message: String(error?.message ?? error) });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`fake-supabase (PGlite + migraciones reales) en ${PORT}`));
