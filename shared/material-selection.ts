import {z} from 'zod';
const point=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)});
export const selectionInput=z.discriminatedUnion('type',[
 z.object({type:z.literal('point'),point}),
 z.object({type:z.literal('box'),box:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).refine(b=>b.x+b.width<=1&&b.y+b.height<=1)})
]);
export type MaterialSelection=z.infer<typeof selectionInput>;
const box=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).refine(b=>b.x+b.width<=1&&b.y+b.height<=1);
export const materialRequest=z.object({projectId:z.uuid(),sourceAssetId:z.uuid().optional(),requestId:z.uuid(),candidateId:z.uuid().optional(),revision:z.number().int().positive().optional(),selection:selectionInput.optional(),recognitionModelId:z.uuid().nullable().default(null),reconstructionModelId:z.uuid().nullable().default(null),resolution:z.union([z.literal(1024),z.literal(2048),z.literal(4096)]).default(1024),textureMode:z.enum(['faithful','ai']).default('ai'),seamless:z.boolean().default(true),quad:z.array(point).length(4).optional(),notes:z.string().max(2000).default(''),confirmMaterialInfo:z.boolean().default(false),sensitivity:z.number().min(.1).max(.9).default(.5),radius:z.number().min(.05).max(1).default(.35),keepOriginal:z.boolean().default(false)});
