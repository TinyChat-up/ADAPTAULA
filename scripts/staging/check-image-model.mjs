/** Explicit metadata request only; never loads .env files, generates images, or displays provider errors/credentials. */
import { DEFAULT_MODEL_REFS } from '../../src/lib/ai/config.ts';
const ref = process.env.AI_MODEL_IMAGE_QUALITY || DEFAULT_MODEL_REFS.IMAGE_QUALITY;
const model = ref?.startsWith('openai:') ? ref.slice(7) : null;
if (!process.argv.includes('--inspect-model')) {
  console.log('NO EJECUTADO: requiere --inspect-model para consultar metadatos en OpenAI. No genera imágenes.');
} else if (!model || !process.env.OPENAI_API_KEY) {
  console.error('NO EJECUTADO: configura el alias OpenAI y el secreto en el entorno seguro.');
  process.exitCode = 2;
} else {
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15000) });
    const data = response.ok ? await response.json() : null;
    const ok = response.ok && data?.id === model;
    console.log(JSON.stringify({ status: ok ? 'PASS' : 'FAIL', model, httpStatus: response.status, generationTested: false }));
    if (!ok) process.exitCode = 1;
  } catch { console.error('NO EJECUTADO: no se pudo verificar el modelo. Sin detalles de credenciales.'); process.exitCode = 2; }
}
