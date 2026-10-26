import { readFileSync } from 'node:fs';
import { test, expect, type BrowserContext } from '@playwright/test';

// Local-only real UI and database consent, with run calls intercepted BEFORE any provider can be reached.
test('elección explícita, cupo y contexto persistido de apoyos visuales',async({page},info)=>{
  test.skip(!process.env.E2E_VISUAL_SUPPORT_STATE,'Requiere fixture local Max y servidor configurado, nunca credenciales reales.');
  expect(['localhost','127.0.0.1']).toContain(new URL(process.env.E2E_BASE_URL!).hostname);
  const config=JSON.parse(readFileSync(process.env.E2E_VISUAL_SUPPORT_CONFIG!,'utf8')) as {workspace:string;material:string};
  const storage=JSON.parse(readFileSync(process.env.E2E_VISUAL_SUPPORT_STATE!,'utf8')) as {cookies:Awaited<ReturnType<BrowserContext['cookies']>>};
  await page.context().addCookies(storage.cookies);
  const serviceHeaders={apikey:'sb_secret_fakefakefakefakefake',authorization:'Bearer sb_secret_fakefakefakefakefake'};
  const profile=await page.request.patch(`http://127.0.0.1:54399/rest/v1/learner_profiles?workspace_id=eq.${config.workspace}`,{headers:serviceHeaders,data:{functional_profile:{schema_version:1,supports:{visual_math_support:'high'},limits:{},allowances:{}}}});
  expect(profile.ok()).toBe(true);
  // Text/image API hosts are never allowed in this local test.
  await page.route(/api\.(anthropic|openai)\.com/,r=>r.abort());
  await page.route('**/api/adaptations/*/run',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Ensayo local: generación detenida antes de llamar a IA.'}})}));
  await page.goto(`/app/materiales/${config.material}`);
  const checkbox=page.getByRole('checkbox',{name:'Crear con apoyos visuales'});
  await expect(checkbox).toBeVisible();await expect(checkbox).not.toBeChecked();
  await expect(page.getByText(/Quedan 5 imágenes/)).toBeVisible();
  await checkbox.focus();await page.keyboard.press('Space');await expect(checkbox).toBeChecked();
  await checkbox.scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('apoyos-opt-in.png'),style:'nextjs-portal{display:none}'});
  await page.getByLabel('Perfil',{exact:true}).selectOption({label:'Ensayo visual'});
  await page.getByRole('button',{name:'Hacer magia',exact:true}).click();
  await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('status').filter({hasText:'Apoyos visuales solicitados.'})).toBeVisible();
  const id=page.url().split('/').pop()!;
  const response=await page.request.get(`http://127.0.0.1:54399/rest/v1/adaptations?id=eq.${id}&select=context_snapshot`,{headers:{apikey:'sb_secret_fakefakefakefakefake',authorization:'Bearer sb_secret_fakefakefakefakefake'}});
  expect(response.ok()).toBe(true);expect((await response.json())[0].context_snapshot.visual_supports).toEqual({requested:true});
});
