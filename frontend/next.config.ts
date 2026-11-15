import type {NextConfig} from 'next';
const backend=new URL(process.env.API_BASE_URL||'http://127.0.0.1:4191');
if(!['http:','https:'].includes(backend.protocol)||backend.username||backend.password||backend.search||backend.hash||backend.pathname!=='/')throw Error('API_BASE_URL must be an HTTP(S) origin');
const config:NextConfig={poweredByHeader:false,devIndicators:false,experimental:{agentUpgrade:"security",proxyClientMaxBodySize:Number.MAX_SAFE_INTEGER},output:'standalone',async rewrites(){return [{source:'/api/:path*',destination:backend.origin+'/api/:path*'}];}};
export default config;
