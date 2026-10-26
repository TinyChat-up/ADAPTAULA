import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({context:null as unknown,workspace:'one',error:null as unknown,flag:vi.fn()}));
vi.mock('@/lib/config/flags',()=>({getFlags:state.flag}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{workspace_id:state.workspace,context_snapshot:state.context},error:state.error})})})})})}));
const {illustrationAvailability}=await import('@/lib/materials/visuals/illustrate/server');
beforeEach(()=>{state.context=null;state.workspace='one';state.error=null;state.flag.mockClear();state.flag.mockReturnValue({aiImagesEnabled:false});});
for(const context of [null,{}, {visual_supports:{requested:false}}, {visual_supports:{requested:'true'}}])it(`no consentimiento ${JSON.stringify(context)}: no alcanza proveedores ni flags`,async()=>{
  state.context=context;expect(await illustrationAvailability({workspaceId:'one',adaptationId:'x',materialId:'m'})).toEqual({available:false,reason:'disabled'});expect(state.flag).not.toHaveBeenCalled();
});
it('consentimiento de otro workspace no autoriza',async()=>{state.context={visual_supports:{requested:true}};state.workspace='other';await illustrationAvailability({workspaceId:'one',adaptationId:'x',materialId:'m'});expect(state.flag).not.toHaveBeenCalled();});
it('con consentimiento sigue aplicando flag de servidor',async()=>{state.context={visual_supports:{requested:true}};expect(await illustrationAvailability({workspaceId:'one',adaptationId:'x',materialId:'m'})).toEqual({available:false,reason:'disabled'});expect(state.flag).toHaveBeenCalledOnce();});
