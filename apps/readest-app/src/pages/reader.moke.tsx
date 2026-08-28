import Head from 'next/head';

import Reader from '@/app/reader/components/Reader';
import Providers from '@/components/Providers';
import { EnvProvider } from '@/context/EnvContext';
import { bootstrapMokeLaunchContext } from '@/helpers/mokeLaunchContext';

import '../styles/globals.css';

if (typeof window !== 'undefined') {
  bootstrapMokeLaunchContext();
}

export default function MokeReaderPage() {
  return (
    <>
      <Head>
        <title>Readest</title>
        <meta
          name='viewport'
          content='minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, user-scalable=no, viewport-fit=cover'
        />
      </Head>
      <EnvProvider>
        <Providers>
          <Reader />
        </Providers>
      </EnvProvider>
    </>
  );
}
