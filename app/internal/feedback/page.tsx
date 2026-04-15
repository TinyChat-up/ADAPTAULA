import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import BrandLogo from "@/components/BrandLogo";

type SearchParamValue = string | string[] | undefined;

type InternalFeedbackPageProps = {
  searchParams?: Promise<Record<string, SearchParamValue>>;
};

type FeedbackRow = {
  id: string;
  created_at: string;
  rating: string;
  comment: string | null;
  adaptation_id: string;
  user_id: string;
};

type ApprovedRow = {
  id: string;
  created_at: string;
  adaptation_id: string;
  user_id: string;
  output_format: string | null;
  student_profile: string | null;
  visual_support_level: string | null;
  feedback_rating: string | null;
  was_approved: boolean | null;
};

const RECENT_OPTIONS = ["7d", "30d", "90d", "all"] as const;

function normalizeParam(value: SearchParamValue) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function formatDate(value: string) {
  if (!value) return "Fecha no disponible";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function parseRecentDays(value: string) {
  if (!RECENT_OPTIONS.includes(value as (typeof RECENT_OPTIONS)[number])) return 30;
  if (value === "all") return null;
  const days = Number.parseInt(value.replace("d", ""), 10);
  return Number.isFinite(days) ? days : 30;
}

function getCutoffIso(days: number | null) {
  if (!days) return null;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function isAllowedInternalUser(email: string | null | undefined) {
  const list = process.env.INTERNAL_FEEDBACK_ALLOWED_EMAILS;
  if (!list) return true;
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const allowed = list
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(normalized);
}

async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components may not be able to write cookies in all execution paths.
          }
        },
      },
    },
  );
}

export const dynamic = "force-dynamic";

export default async function InternalFeedbackPage(props: InternalFeedbackPageProps) {
  const supabase = await createSupabaseServer();
  const params = (await props.searchParams) || {};

  const rating = normalizeParam(params.rating);
  const outputFormat = normalizeParam(params.output_format);
  const studentProfile = normalizeParam(params.student_profile);
  const recent = normalizeParam(params.recent) || "30d";
  const cutoffIso = getCutoffIso(parseRecentDays(recent));

  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user) {
    redirect("/login?next=/internal/feedback");
  }

  if (!isAllowedInternalUser(user.email)) {
    return (
      <div className="min-h-screen bg-[#f7f9ff] px-6 py-16 text-[#1a1c1c]">
        <div className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-white p-8 shadow-sm">
          <h1 className="font-sans text-3xl font-extrabold text-rose-700">
            Acceso restringido
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            Tu cuenta no tiene permisos para entrar a la vista interna de feedback.
          </p>
          <Link href="/" className="mt-6 inline-block rounded-full bg-[#0B4FB3] px-5 py-2 text-sm font-bold text-white">
            Volver a la app
          </Link>
        </div>
      </div>
    );
  }

  let feedbackQuery = supabase
    .from("adaptation_feedback")
    .select("id, created_at, rating, comment, adaptation_id, user_id")
    .order("created_at", { ascending: false })
    .limit(200);

  if (rating) {
    feedbackQuery = feedbackQuery.eq("rating", rating);
  }
  if (cutoffIso) {
    feedbackQuery = feedbackQuery.gte("created_at", cutoffIso);
  }

  let approvedQuery = supabase
    .from("approved_adaptation_examples")
    .select(
      "id, created_at, adaptation_id, user_id, output_format, student_profile, visual_support_level, feedback_rating, was_approved",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (outputFormat) {
    approvedQuery = approvedQuery.eq("output_format", outputFormat);
  }
  if (studentProfile) {
    approvedQuery = approvedQuery.eq("student_profile", studentProfile);
  }
  if (cutoffIso) {
    approvedQuery = approvedQuery.gte("created_at", cutoffIso);
  }

  const [feedbackResult, approvedResult] = await Promise.all([feedbackQuery, approvedQuery]);
  const feedbackRows = (feedbackResult.data || []) as FeedbackRow[];
  const approvedRows = (approvedResult.data || []) as ApprovedRow[];

  const approvedSet = new Set(
    approvedRows.map((row) => `${row.adaptation_id}:${row.user_id}`),
  );

  const outputFormats = Array.from(
    new Set(
      approvedRows
        .map((row) => row.output_format || "")
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, "es"));

  const studentProfiles = Array.from(
    new Set(
      approvedRows
        .map((row) => row.student_profile || "")
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, "es"));

  return (
    <div className="min-h-screen bg-[#f7f9ff] text-[#1a1c1c]">
      <nav className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-8 py-4">
          <Link href="/" className="font-sans text-2xl font-black tracking-tight text-[#0B4FB3]"><BrandLogo compact /></Link>
          <div className="flex items-center gap-6 text-sm font-semibold text-slate-600">
            <Link href="/">Home</Link>
            <Link href="/history">Historial</Link>
            <Link href="/styles">Mis estilos</Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-[1440px] px-8 py-10">
        <header className="mb-8">
          <h1 className="font-sans text-4xl font-extrabold tracking-tight text-slate-900">
            Interno · Feedback beta
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Revisión rápida de feedback y ejemplos aprobados de la beta cerrada.
          </p>
        </header>

        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <form className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
                Rating
              </label>
              <select
                name="rating"
                defaultValue={rating}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Todos</option>
                <option value="useful">Sí, me sirve</option>
                <option value="partial">Más o menos</option>
                <option value="not_useful">No, no está como quiero</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
                Output format
              </label>
              <select
                name="output_format"
                defaultValue={outputFormat}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Todos</option>
                {outputFormats.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
                Perfil
              </label>
              <select
                name="student_profile"
                defaultValue={studentProfile}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Todos</option>
                {studentProfiles.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
                Fecha reciente
              </label>
              <select
                name="recent"
                defaultValue={recent}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="7d">Últimos 7 días</option>
                <option value="30d">Últimos 30 días</option>
                <option value="90d">Últimos 90 días</option>
                <option value="all">Todo</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="w-full rounded-xl bg-[#0B4FB3] px-4 py-2 text-sm font-bold text-white hover:bg-[#083b88]"
              >
                Filtrar
              </button>
              <Link
                href="/internal/feedback"
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Limpiar
              </Link>
            </div>
          </form>
        </section>

        <section className="mb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-sans text-2xl font-bold text-slate-900">
              Feedback reciente
            </h2>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              {feedbackRows.length} registros
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[160px_140px_1fr_220px_220px_120px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">
              <span>Fecha</span>
              <span>Rating</span>
              <span>Comentario</span>
              <span>Adaptation</span>
              <span>User</span>
              <span>Ejemplo</span>
            </div>
            {feedbackRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-600">Sin feedback en este filtro.</p>
            ) : (
              <ul>
                {feedbackRows.map((row) => {
                  const key = `${row.adaptation_id}:${row.user_id}`;
                  return (
                    <li
                      key={row.id}
                      className="grid grid-cols-[160px_140px_1fr_220px_220px_120px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
                    >
                      <span className="text-slate-600">{formatDate(row.created_at)}</span>
                      <span className="font-semibold text-slate-800">{row.rating}</span>
                      <span className="text-slate-700">{row.comment || "-"}</span>
                      <span className="truncate font-mono text-xs text-slate-500">{row.adaptation_id}</span>
                      <span className="truncate font-mono text-xs text-slate-500">{row.user_id}</span>
                      <span
                        className={`inline-flex w-fit items-center rounded-full px-2 py-1 text-xs font-bold ${
                          approvedSet.has(key)
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {approvedSet.has(key) ? "Sí" : "No"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-sans text-2xl font-bold text-slate-900">
              Ejemplos aprobados recientes
            </h2>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              {approvedRows.length} registros
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[160px_220px_220px_170px_170px_150px_140px_120px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">
              <span>Fecha</span>
              <span>Adaptation</span>
              <span>User</span>
              <span>Formato</span>
              <span>Perfil</span>
              <span>Soporte visual</span>
              <span>Feedback</span>
              <span>Aprobado</span>
            </div>
            {approvedRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-600">
                Sin ejemplos aprobados en este filtro.
              </p>
            ) : (
              <ul>
                {approvedRows.map((row) => (
                  <li
                    key={row.id}
                    className="grid grid-cols-[160px_220px_220px_170px_170px_150px_140px_120px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
                  >
                    <span className="text-slate-600">{formatDate(row.created_at)}</span>
                    <span className="truncate font-mono text-xs text-slate-500">{row.adaptation_id}</span>
                    <span className="truncate font-mono text-xs text-slate-500">{row.user_id}</span>
                    <span className="text-slate-700">{row.output_format || "-"}</span>
                    <span className="text-slate-700">{row.student_profile || "-"}</span>
                    <span className="text-slate-700">{row.visual_support_level || "-"}</span>
                    <span className="text-slate-700">{row.feedback_rating || "-"}</span>
                    <span
                      className={`inline-flex w-fit items-center rounded-full px-2 py-1 text-xs font-bold ${
                        row.was_approved ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {row.was_approved ? "Sí" : "No"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
