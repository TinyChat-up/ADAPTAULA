import { NextResponse } from "next/server";

type ArasaacApiItem = {
  _id?: number;
  keywords?: Array<{ keyword?: string }>;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  if (!q) {
    return NextResponse.json({ error: "Falta parámetro q." }, { status: 400 });
  }

  try {
    const response = await fetch(
      `https://api.arasaac.org/api/pictograms/es/search/${encodeURIComponent(q)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (response.status === 404) {
      return NextResponse.json({ concept: q, items: [] });
    }

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        return NextResponse.json({ concept: q, items: [] });
      }
      return NextResponse.json(
        { error: "ARASAAC no respondió correctamente." },
        { status: 502 },
      );
    }

    const data = (await response.json()) as ArasaacApiItem[];
    const items = Array.isArray(data) ? data : [];
    const normalized = items
      .filter((item) => typeof item?._id === "number")
      .slice(0, 6)
      .map((item) => {
        const id = Number(item._id);
        const keyword =
          item.keywords?.find((entry) => typeof entry.keyword === "string")
            ?.keyword || q;
        return {
          concept: q,
          id,
          keyword,
          imageUrl: `https://static.arasaac.org/pictograms/${id}/${id}_300.png`,
        };
      });

    return NextResponse.json({ concept: q, items: normalized });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error de red consultando ARASAAC.",
      },
      { status: 502 },
    );
  }
}
