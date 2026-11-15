export type Project={id:string;workspace_id:string;name:string;status:string;purpose?:'studio'|'extract'|null;created_at:string;coverUrl?:string|null;coverAssetId?:string|null};
export type Asset={id:string;workspace_id:string;project_id:string;storage_key:string;kind:string;mime_type:string;name:string;width:number;height:number;url?:string;status:string};
export type Version={id:string;project_id:string;asset_id:string;parent_version_id:string|null;source_job_id:string|null;label:string;created_at:string;asset?:Asset};
export type Job={id:string;status:string;provider:string;parameters:Record<string,unknown>;error_message?:string;output_asset_id?:string};
