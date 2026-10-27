/** The left half of the sign-in screen: the shop's sign over the sea, and what the app is for. */
export function LoginArt() {
  return (
    <section className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
      <Waves />
      <div className="relative font-display text-7xl leading-[1.15] text-tag">
        سمك
        <br />
        طازة
      </div>
      <p className="relative max-w-xs text-lg leading-8 text-white/70">
        البيع بالكيلو أو بالأوزان الجاهزة، والمخزون يُخصم مع كل فاتورة.
      </p>
    </section>
  );
}

function Waves() {
  return (
    <svg className="absolute inset-0 size-full text-white/[0.06]" preserveAspectRatio="none" aria-hidden>
      <defs>
        <pattern id="waves" width="120" height="36" patternUnits="userSpaceOnUse">
          <path d="M0 18 Q 30 6 60 18 T 120 18" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#waves)" />
    </svg>
  );
}
