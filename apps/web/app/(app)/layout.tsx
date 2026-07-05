import { NavBar } from '@/components/NavBar';
import { AudioSolo } from '@/components/AudioSolo';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <AudioSolo />
      <NavBar />
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
