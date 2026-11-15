// Keep originals for downloads and processing; only resize visual previews.
export function imagePreview(url?:string,width=640){
 if(!url)return undefined;
 if(!/^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/sign\/qmx-assets\//.test(url))return url;
 return '/api/v1/preview?source='+encodeURIComponent(url)+'&width='+width;
}
