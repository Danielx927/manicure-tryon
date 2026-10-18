// Themes and layouts the site owner can preview before settling on one.
// The choice is stored per browser and can also be set with ?theme=…&layout=….

export const THEMES = [
  { id: "blush", name: "Blush", swatch: ["#fdf7f8", "#c2185b"] },
  { id: "noir", name: "Noir", swatch: ["#141116", "#d4af6a"] },
  { id: "studio", name: "Studio", swatch: ["#f6f6f4", "#111111"] },
  { id: "pastel", name: "Pastel", swatch: ["#f5f3ff", "#7c5cff"] },
] as const;

export const LAYOUTS = [
  { id: "split", name: "Side panel", blurb: "Hand on the left, designs on the right" },
  { id: "stacked", name: "Stacked", blurb: "Big hand on top, designs in a row below" },
  { id: "showcase", name: "Gallery first", blurb: "Designs on the left, hand on the right" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type LayoutId = (typeof LAYOUTS)[number]["id"];

export const THEME_KEY = "nail-tryon.theme";
export const LAYOUT_KEY = "nail-tryon.layout";

/**
 * Runs before the page paints (inlined in the root layout) so the chosen look
 * shows without a flash of the default one.
 */
export const LOOK_INIT_SCRIPT = `(function(){try{
var q=new URLSearchParams(location.search),d=document.documentElement;
var t=q.get("theme")||localStorage.getItem("${THEME_KEY}");
var l=q.get("layout")||localStorage.getItem("${LAYOUT_KEY}");
if(${JSON.stringify(THEMES.map((t) => t.id))}.indexOf(t)>=0){d.dataset.theme=t;localStorage.setItem("${THEME_KEY}",t);}
if(${JSON.stringify(LAYOUTS.map((l) => l.id))}.indexOf(l)>=0){d.dataset.layout=l;localStorage.setItem("${LAYOUT_KEY}",l);}
}catch(e){}})();`;
