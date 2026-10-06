const TIME_ZONE = "Europe/Madrid";

export function greetingFor(date: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("es-ES", { hour: "numeric", hour12: false, timeZone: TIME_ZONE }).format(date),
  );
  if (hour >= 6 && hour < 13) return "Buenos días";
  if (hour >= 13 && hour < 21) return "Buenas tardes";
  return "Buenas noches";
}

export function formatDay(value: string | Date): string {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: TIME_ZONE }).format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(new Date(value));
}

export function formatEuros(cents: number): string {
  const euros = cents / 100;
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(euros) ? 0 : 2,
  }).format(euros);
}
