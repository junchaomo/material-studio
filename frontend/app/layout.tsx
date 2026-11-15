import type {Metadata} from 'next';
import RetryCenter from '../components/retry-center.tsx';
import DeletionCenter from '../components/deletion-center.tsx';
import './globals.css';
import './platform.css';
import './studio-design.css';
export const metadata:Metadata={title:'AI材质提取',description:'从图片取样、透视矫正到纹理重建的专业材质工作台'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body><DeletionCenter><RetryCenter>{children}</RetryCenter></DeletionCenter></body></html>;}
