import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://47.108.221.191:8443'),
  title: '序作 · 个人计划与项目管理',
  description: '清晰安排每日工作，持续追踪项目进度与时间投入。',
  openGraph: {
    title: '序作 · 个人计划与项目管理',
    description: '把计划变成节奏，让进度清晰可见。',
    type: 'website',
    locale: 'zh_CN',
    url: '/',
    images: [{ url: '/og.png', width: 1536, height: 864, alt: '序作个人计划与项目管理工作台' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '序作 · 个人计划与项目管理',
    description: '把计划变成节奏，让进度清晰可见。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={geist.variable}>{children}</body></html>;
}
