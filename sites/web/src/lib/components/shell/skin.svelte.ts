// The device's theme ("skin", skins.ts lists them), kept in localStorage like the light or dark choice.
import { readLocal, writeLocal } from "../ui/storage";
import { SKIN_KEY, isSkinId, skinById, skinFontsHref, type Skin, type SkinId } from "./skins";

function stored(): SkinId {
  const value = readLocal(SKIN_KEY);
  return isSkinId(value) ? value : "default";
}

class SkinChoice {
  id = $state<SkinId>(stored());

  get current(): Skin {
    return skinById(this.id);
  }

  set(id: SkinId): void {
    this.id = id;
    writeLocal(SKIN_KEY, id === "default" ? null : id);
  }
}

export const skin = new SkinChoice();

/** Mirrors the skin onto <html> and loads its fonts. Call from the root layout inside an effect. */
export function applySkin(id: SkinId): void {
  const root = document.documentElement;
  if (id === "default") delete root.dataset.skin;
  else root.dataset.skin = id;
  const href = skinFontsHref(id);
  let link = document.getElementById("skin-fonts") as HTMLLinkElement | null;
  if (href === null) {
    link?.remove();
    return;
  }
  if (link === null) {
    link = document.createElement("link");
    link.id = "skin-fonts";
    link.rel = "stylesheet";
    document.head.append(link);
  }
  if (link.href !== href) link.href = href;
}
