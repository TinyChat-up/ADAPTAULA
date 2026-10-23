import { test,expect } from '@playwright/test';
const state=process.env.E2E_STRIPE_PILOT_STATE;
test('cuenta autorizada: sección privada, foco, carga y error de Checkout simulado',async({browser,baseURL},info)=>{
  test.skip(!state,'Requiere cuenta ficticia y servidor local configurado para su workspace; no usa Stripe real.');
  const url=new URL(baseURL!);
  if(!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Este ensayo solo admite el backend local ficticio.');
  const context=await browser.newContext({baseURL,storageState:state,viewport:info.project.use.viewport});
  try {
    const page=await context.newPage();await page.goto('/app/uso');
    await expect(page.getByRole('heading',{name:'Prueba privada de Max'})).toBeVisible();
    const button=page.getByRole('button',{name:'Abrir Stripe de prueba'});await button.focus();await expect(button).toBeFocused();
    const panel=page.locator('section[aria-labelledby="piloto-privado"]');
    await panel.screenshot({path:info.outputPath('piloto-privado.png')});
    let release:()=>void=()=>{};
    const response=new Promise<void>(resolve=>{release=resolve;});
    await page.route('**/api/stripe/checkout',async route=>{
      await response;
      await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Ensayo local: error de conexión simulado.'}})});
    });
    await button.press('Enter');await expect(page.getByRole('button',{name:'Preparando Stripe de prueba…'})).toBeDisabled();
    release();await expect(page.getByText('Ensayo local: error de conexión simulado.')).toBeVisible();await expect(button).toBeEnabled();
    await panel.screenshot({path:info.outputPath('piloto-error-simulado.png')});
  } finally {await context.close();}
});
