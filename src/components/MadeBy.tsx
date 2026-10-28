import { Globe, Phone } from "lucide-react";

/** Who made the app and how to reach them, at the foot of the screens outside the till (sign-in,
 *  activation). The site is plain text: a link would open it inside the app's own window. */
export function MadeBy() {
  return (
    <div className="relative flex items-center gap-4 border-t border-white/10 pt-6 text-white">
      <img src="/logo.jpeg" alt="" className="size-14 shrink-0 rounded-full ring-1 ring-white/15" />
      <div className="min-w-0">
        <div className="text-xs text-white/50">تصميم وتطوير</div>
        <div dir="ltr" className="text-right font-semibold tracking-wide">
          BIT Technologies
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/70">
          <span className="flex items-center gap-1.5">
            <Phone className="size-3.5" aria-hidden />
            <span dir="ltr" className="select-text">
              01501053600
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <Globe className="size-3.5" aria-hidden />
            <span dir="ltr" className="select-text">
              bittech.site
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
