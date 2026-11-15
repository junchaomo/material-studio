import {z} from 'zod';
const point=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)});
export const quadInput=z.array(point).length(4).refine(q=>{
 const signs=q.map((a,i)=>{const b=q[(i+1)%4],c=q[(i+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
 return signs.every(x=>x>1e-7)||signs.every(x=>x< -1e-7);
},'请选择同一平面上的有效四角');
const base={projectId:z.uuid()};
const taskBase={...base,sourceAssetId:z.uuid(),groupId:z.uuid(),modelId:z.uuid().nullable().optional()};
export const platformInput=z.discriminatedUnion('action',[
 z.object({...taskBase,action:z.literal('scan'),parameters:z.object({focus:z.string().max(1000).default('')})}),
 z.object({...taskBase,action:z.literal('generate'),candidateId:z.uuid(),parameters:z.object({resolution:z.union([z.literal(1024),z.literal(2048),z.literal(4096)]),seamless:z.boolean()})}),
 z.object({...taskBase,action:z.literal('auto_generate'),candidateId:z.uuid(),revision:z.number().int().positive(),parameters:z.object({mode:z.enum(['direct']).default('direct'),resolution:z.union([z.literal(1024),z.literal(2048),z.literal(4096)]),seamless:z.boolean()})}),
 z.object({...taskBase,action:z.literal('segment'),candidateId:z.uuid(),parameters:z.object({points:z.array(point.extend({label:z.union([z.literal(0),z.literal(1)])})).max(500),box:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).refine(b=>b.x+b.width<=1.000001&&b.y+b.height<=1.000001).nullable()})}),
 z.object({...base,action:z.literal('mask'),candidateId:z.uuid(),revision:z.number().int().positive(),assetId:z.uuid()}),
 z.object({...base,action:z.literal('edit_material'),versionId:z.uuid(),assetId:z.uuid(),edits:z.object({brightness:z.number().min(.5).max(1.5),saturation:z.number().min(0).max(2),hue:z.number().min(-180).max(180),seamFix:z.boolean()})}),
 z.object({...taskBase,action:z.literal('render'),parameters:z.object({prompt:z.string().trim().min(1).max(2000),optimizePrompt:z.boolean().default(false),promptModelId:z.uuid().nullable().default(null),parentVersionId:z.uuid().nullable(),maskAssetId:z.uuid().nullable(),referenceIds:z.array(z.uuid()).max(4),strength:z.number().min(0).max(1),seed:z.number().int().nonnegative()})}),
 z.object({...base,action:z.literal('candidate'),candidateId:z.uuid(),revision:z.number().int().positive(),name:z.string().trim().min(1).max(80),category:z.enum(['石材','金属','木材','涂料','砖材','铺装','景观','玻璃','标识','其他']),kind:z.enum(['重复纹理','纯色渐变','专用图案']),part:z.string().max(200),description:z.string().max(2000),quad:quadInput.nullable(),confirmed:z.boolean(),dismissed:z.boolean().default(false),retain:z.boolean().default(false)}).refine(x=>!x.confirmed||x.quad!==null,'确认前需选择纯净取样区'),
 z.object({...base,action:z.literal('merge'),ids:z.array(z.uuid()).min(2)}),
 z.object({...base,action:z.literal('split'),candidateId:z.uuid()}),
 z.object({...base,action:z.literal('retry'),taskId:z.uuid(),acknowledgeCost:z.boolean().default(false)}),
 z.object({...base,action:z.literal('cancel'),taskId:z.uuid()}),
 z.object({...base,action:z.literal('confirm_material'),versionId:z.uuid(),widthM:z.number().positive().nullable().optional(),heightM:z.number().positive().nullable().optional(),color:z.string().max(100),qualityReviewed:z.literal(true)})
]);
export type Quad={x:number;y:number}[];
export type Candidate={id:string;group_id:string;source_asset_id:string;name:string;category:string;kind:string;part:string;description:string;quad:Quad|null;mask_asset_id?:string|null;sources:{region:number;quad:Quad|null}[];risks:string[];confidence:number;confirmed:boolean;dismissed:boolean;revision:number};
export type Task={id:string;group_id:string;source_asset_id:string;kind:string;region_index:number|null;status:string;stage:string;parameters:Record<string,any>;result?:Record<string,any>;error_message?:string;error_code?:string;usage_event_id?:string;retry_of?:string;created_at:string};
export type MaterialVersion={id:string;candidate_id:string;task_id:string;asset_id:string;code:string;name:string;category:string;part:string;color:string;sources:unknown[];parameters:Record<string,unknown>;confirmed:boolean;physical_width_m:number|null;physical_height_m:number|null;created_at:string};
export type Model={id:string|null;name:string;model:string;kind:string;protocol:string;parameters:string[];ready:boolean};
export const taskLabels:Record<string,string>={queued:'排队',processing:'处理中',awaiting_confirmation:'待确认',completed:'完成',failed:'失败',cancelled:'取消'};
