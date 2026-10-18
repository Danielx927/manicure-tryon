import Link from "next/link";

/** Top bar with the brand and a button to the other page (admin or try-on). */
export default function SiteHeader(props: { link: { href: string; label: string } }) {
  return (
    <nav className="site-header">
      <Link href="/" className="brand">
        Nail Try-On
      </Link>
      <Link href={props.link.href} className="btn small">
        {props.link.label}
      </Link>
    </nav>
  );
}
