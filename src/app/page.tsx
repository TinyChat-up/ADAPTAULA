export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-8 lg:px-12">
        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12">
          <p className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
            IA para educacion inclusiva
          </p>
          <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
            Adapta cualquier material en segundos
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-600">
            AdaptAula utiliza inteligencia artificial para transformar contenido educativo en materiales claros, adaptados y accesibles para cada estudiante.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="#"
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Probar ahora
            </a>
            <a
              href="#como-funciona"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              Ver cómo funciona
            </a>
          </div>
        </section>

        <section id="como-funciona" className="mt-16">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Cómo funciona</h2>
          <div className="mt-7 grid gap-5 md:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-emerald-700">Paso 1</p>
              <h3 className="mt-2 text-lg font-semibold">Sube el material</h3>
              <p className="mt-2 text-sm text-slate-600">
                Carga documentos, ejercicios o apuntes en pocos segundos.
              </p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-emerald-700">Paso 2</p>
              <h3 className="mt-2 text-lg font-semibold">Configura la adaptación</h3>
              <p className="mt-2 text-sm text-slate-600">
                Elige nivel, objetivos y apoyos según las necesidades del aula.
              </p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-emerald-700">Paso 3</p>
              <h3 className="mt-2 text-lg font-semibold">Obtiene el resultado</h3>
              <p className="mt-2 text-sm text-slate-600">
                Genera recursos adaptados y listos para usar en clase al instante.
              </p>
            </article>
          </div>
        </section>

        <section className="mt-16 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Beneficios</h2>
          <div className="mt-7 grid gap-4 md:grid-cols-3">
            <article className="rounded-2xl bg-slate-50 p-5">
              <h3 className="font-semibold">Adaptacion inclusiva</h3>
              <p className="mt-2 text-sm text-slate-600">
                Crea recursos que responden a distintas necesidades del aula.
              </p>
            </article>
            <article className="rounded-2xl bg-slate-50 p-5">
              <h3 className="font-semibold">Ahorro de tiempo</h3>
              <p className="mt-2 text-sm text-slate-600">
                Reduce horas de preparacion con flujos de trabajo simples.
              </p>
            </article>
            <article className="rounded-2xl bg-slate-50 p-5">
              <h3 className="font-semibold">Pictogramas y apoyos visuales</h3>
              <p className="mt-2 text-sm text-slate-600">
                Refuerza comprensión con apoyos visuales listos para imprimir.
              </p>
            </article>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5 text-sm text-slate-500 sm:px-8 lg:px-12">
          <p>AdaptAula</p>
          <p>Educacion accesible con IA</p>
        </div>
      </footer>
    </div>
  );
}
