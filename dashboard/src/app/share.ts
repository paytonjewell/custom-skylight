// "Share → White Lotus HQ" in the phone app (SharePlugin.java). Photos are added as the Add button adds
// them; a link opens Kitchen importing it as a recipe. In a browser the installed web app gets shares
// through its service worker instead (public/sw.js, receiveSharedPhotos in src/views/Photos.tsx).
import type { PluginListenerHandle } from '@capacitor/core';
import { addSharedPhotos } from '../views/Photos';
import { openSharedRecipe } from '../views/recipes/AddRecipeSheet';
import { toast } from './ui';

interface Shared {
  text: string | null;
  files: { index: number; name: string; type: string; size: number }[];
}
interface SharePlugin {
  read(opts: { index: number }): Promise<{ data: string }>;
  clear(): Promise<void>;
  addListener(event: 'shared', fn: (s: Shared) => void): Promise<PluginListenerHandle>;
}

export async function startAppShare(): Promise<void> {
  // Loaded only in the app. The plugin is used straight away, never passed through a promise: it
  // answers to any method name, `then` included (see src/data/push.ts).
  const { registerPlugin } = await import('@capacitor/core');
  const share = registerPlugin<SharePlugin>('Share');
  // The native side keeps a share until this listens, so one that started the app still arrives
  void share.addListener('shared', (s) => {
    void receive(share, s).catch((e) => {
      console.warn('Share failed', e);
      toast('Couldn’t add what was shared', { icon: 'x' });
    });
  });
}

async function receive(share: SharePlugin, s: Shared): Promise<void> {
  if (s.files.length) {
    const files: File[] = [];
    for (const f of s.files) {
      const { data } = await share.read({ index: f.index });
      const blob = await (await fetch(`data:${f.type};base64,${data}`)).blob();
      files.push(new File([blob], f.name, { type: f.type, lastModified: Date.now() }));
    }
    await addSharedPhotos(files);
    await share.clear();
    return;
  }
  // Browsers often put the link in the text, after the page title
  const link = s.text?.match(/https?:\/\/\S+/)?.[0];
  if (link) openSharedRecipe(link);
  else toast('Share a photo, or a link to a recipe', { icon: 'x' });
}
