import Image from "next/image";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto flex w-full max-w-7xl items-center px-4 py-6 sm:px-8 md:px-12 md:py-10 lg:px-16">
        <Link
          href="/"
          className="flex items-center gap-3 text-3xl font-medium tracking-tight md:gap-4 md:text-5xl lg:text-6xl"
        >
          <Image
            src="/howdy-logo.png"
            alt=""
            width={96}
            height={96}
            className="size-10 shrink-0 md:size-16 lg:size-20"
          />
          Howdy
        </Link>
      </div>
    </footer>
  );
}
