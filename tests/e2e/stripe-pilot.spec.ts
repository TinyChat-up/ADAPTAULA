import { test,expect } from '@playwright/test';
import { signUpAndOnboard,uniqueEmail } from './helpers';

test('piloto apagado: cuenta normal sin contratación privada ni imágenes activadas',async({page})=>{
  await signUpAndOnboard(page,uniqueEmail());
  await page.goto('/app/uso');
  await expect(page.getByRole('heading',{name:'Plan y cuenta',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Prueba privada de Max'})).toHaveCount(0);
  const response=await page.request.post('/api/stripe/checkout',{headers:{origin:'http://localhost:3100'}});
  expect(response.status()).toBe(404);
  await expect(page.getByRole('heading',{name:/Tu plan Free/})).toBeVisible();
});
test('checkout exige sesión y origen; webhook desactivado no procesa eventos',async({page})=>{
  expect((await page.request.post('/api/stripe/checkout',{headers:{origin:'http://localhost:3100'}})).status()).toBe(401);
  expect((await page.request.post('/api/stripe/checkout',{headers:{origin:'https://foreign.example'}})).status()).toBe(403);
  expect((await page.request.post('/api/stripe/webhook',{data:{livemode:true}})).status()).toBe(503);
});
