import type { Metadata } from 'next'
import './globals.css'
import ClientLayout from '@/components/ClientLayout'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: '2006 · The Show',
  description: 'The live and online home of 2006 by Artistic Accessibility Collective.',
  icons: {
    icon: '/2006/art.png',
    shortcut: '/2006/art.png',
    apple: '/2006/art.png',
  },
  openGraph: {
    title: '2006 · The Show',
    description: 'The live and online home of 2006 by Artistic Accessibility Collective.',
    images: ['/2006/art.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '2006 · The Show',
    description: 'The live and online home of 2006 by Artistic Accessibility Collective.',
    images: ['/2006/art.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}
