import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({plan:'max',limit:5,used:0,enabled:true,images:true,workspace:'one',provider:true}));
vi.mock('@/lib/config/flags',()=>({getFlags:()=>({aiImagesEnabled:fixture.enabled})}));
vi.mock('@/lib/config/env.server',()=>({serverEnv:()=>({AI_IMAGES_PILOT_MODE:'local',AI_IMAGES_PILOT_WORKSPACE_ID:'one',AI_IMAGES_PILOT_SUPABASE_URL:'http://127.0.0.1:54399',AI_MODEL_STANDARD:'anthropic:claude-sonnet-5-5',AI_MODEL_IMAGE_QUALITY:'openai:gpt-image-2.5-sunburst'})}));
vi.mock('@/lib/config/env.public',()=>({publicEnv:()=>({NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54399'})}));
vi.mock('@/lib/plans/usage',()=>({getWorkspaceUsage:async()=>({plan:{slug:fixture.plan},images:{limit:fixture.limit,used:fixture.used},features:{image_generation:fixture.images,illustrations_per_adaptation:3}})}));
vi.mock('@/lib/ai/runtime',()=>({imageProviderFor:()=>{if(!fixture.provider)throw new Error('not configured');return {};},providerFor:()=>({})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({})}));
const {visualSupportOffer}=await import('@/lib/materials/visuals/illustrate/server');
beforeEach(()=>Object.assign(fixture,{plan:'max',limit:5,used:0,enabled:true,images:true,workspace:'one',provider:true}));
for(const plan of ['free','pro'])it(`${plan} no obtiene oferta aunque el cliente la solicite`,async()=>{fixture.plan=plan;expect(await visualSupportOffer('one')).toBeNull();});
it('Max efectivo devuelve cupo real y muestra agotamiento sin ofrecer nueva generación',async()=>{expect(await visualSupportOffer('one')).toEqual({remaining:5,maxPerAdaptation:3});fixture.used=5;expect(await visualSupportOffer('one')).toEqual({remaining:0,maxPerAdaptation:3});});
it('flag, aislamiento y credenciales siguen siendo obligatorios',async()=>{
  fixture.enabled=false;expect(await visualSupportOffer('one')).toBeNull();fixture.enabled=true;
  expect(await visualSupportOffer('other')).toBeNull();fixture.provider=false;expect(await visualSupportOffer('one')).toBeNull();
});
