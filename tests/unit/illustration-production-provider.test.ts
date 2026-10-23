import { expect,it,vi } from 'vitest';
const providers=vi.hoisted(()=>({image:vi.fn(),text:vi.fn()}));
vi.mock('@/lib/ai/runtime',()=>({imageProviderFor:providers.image,providerFor:providers.text}));
vi.mock('@/lib/config/flags',()=>({getFlags:()=>({aiImagesEnabled:true})}));
vi.mock('@/lib/config/env.public',()=>({publicEnv:()=>({NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54399'})}));
vi.mock('@/lib/config/env.server',()=>({serverEnv:()=>({
  AI_IMAGES_PILOT_MODE:'local',AI_IMAGES_PILOT_WORKSPACE_ID:'one',AI_IMAGES_PILOT_SUPABASE_URL:'http://127.0.0.1:54399',
  AI_MODEL_STANDARD:'anthropic:claude-sonnet-5-5',AI_MODEL_IMAGE_QUALITY:'mock:dibujo',
})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:async()=>({data:{slug:'max',monthly_images:5,features:{image_generation:true}}})})}));
const {illustrationAvailability}=await import('@/lib/materials/visuals/illustrate/server');
it('el servidor no entrega dibujos mock como imágenes generadas aunque el plan y flag permitan ilustrar',async()=>{
  const result=await illustrationAvailability({workspaceId:'one',adaptationId:'test',materialId:'test'});
  expect(result).toEqual({available:false,reason:'service'});
  expect(providers.image).not.toHaveBeenCalled();expect(providers.text).not.toHaveBeenCalled();
});
