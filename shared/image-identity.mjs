// Storage signatures rotate without changing the underlying private asset.
export function imageIdentity(url) {
 try {
  const parsed = new URL(url);
  if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.supabase.co') && parsed.pathname.startsWith('/storage/v1/object/sign/qmx-assets/')) return parsed.origin + parsed.pathname;
 } catch {}
 return url;
}
