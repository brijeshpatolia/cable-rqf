import { redirect } from 'next/navigation';

/**
 * The Inbox becomes the home screen in Phase 3, when documents start arriving.
 * Until then the Catalogue is where an engineer starts.
 */
export default function HomePage() {
  redirect('/catalogue');
}
