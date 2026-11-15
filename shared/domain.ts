import {z} from 'zod';
export const projectCreateInput=z.object({name:z.string().trim().min(1).max(100),purpose:z.enum(['studio','extract'])}).strict();
export const projectUpdateInput=z.object({name:z.string().trim().min(1).max(100),status:z.enum(['active','archived','deleted']),purpose:z.enum(['studio','extract']).optional()}).strict();
export const generationInput=z.object({projectId:z.uuid(),sourceAssetId:z.uuid(),parentVersionId:z.uuid().nullable().optional(),maskAssetId:z.uuid().nullable().optional(),referenceIds:z.array(z.uuid()).max(4).default([]),prompt:z.string().trim().min(1).max(2000),template:z.enum(['architecture','landscape','urban','interior']),count:z.number().int().min(1).max(4).default(1),strength:z.number().min(0).max(1).default(.45),seed:z.number().int().min(0).max(2147483647).default(42),idempotencyKey:z.uuid()}).strict();
export const uploadInput=z.object({projectId:z.uuid(),name:z.string().min(1).max(200),mime:z.enum(['image/jpeg','image/png','image/webp']),size:z.number().int().positive(),kind:z.enum(['source','reference','mask','material']).default('source')}).strict();

