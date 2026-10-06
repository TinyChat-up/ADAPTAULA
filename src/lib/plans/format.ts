export function limitCopy(planName: string, limit: number): string {
  return `Has utilizado ${limit === 1 ? "el perfil incluido" : `los ${limit} perfiles incluidos`} en ${planName}.`;
}
