import { forwardRef } from "react";
import {
  Link,
  NavLink,
  useLocation,
  type LinkProps,
  type NavLinkProps,
} from "react-router-dom";
import { localeFromPath, withLocale, type Locale } from "@/lib/locale";

// Locale-preserving replacements for react-router's <Link>/<NavLink>.
//
// Why they exist: internal links used to be written as bare paths ("/explore"),
// so every link on a Spanish page pointed at the Catalan URL. That sent all the
// internal authority to the ca URLs and made the /es and /en trees dead ends
// that a crawler leaves after one click. These wrappers run the `to` path
// through withLocale() with the locale of the page the link is rendered on, so
// a link written once works in all three languages.
//
// Paths that are deliberately language-neutral (the authenticated app, /auth,
// /verify) are passed through unchanged by withLocale — writing
// <LocaleLink to="/dashboard"> is correct and stays "/dashboard".

/** The locale of the page currently rendered, read from the URL. */
export function useLocale(): Locale {
  const { pathname } = useLocation();
  return localeFromPath(pathname);
}

/**
 * `(path) => path in the current locale`. For the places that need a string
 * rather than an element — a <Navigate to>, an <a href>, a redirect target.
 */
export function useLocalePath(): (path: string) => string {
  const locale = useLocale();
  return (path: string) => withLocale(path, locale);
}

export const LocaleLink = forwardRef<HTMLAnchorElement, LinkProps>(
  function LocaleLink({ to, ...rest }, ref) {
    const localize = useLocalePath();
    return <Link ref={ref} to={typeof to === "string" ? localize(to) : to} {...rest} />;
  },
);

export const LocaleNavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  function LocaleNavLink({ to, ...rest }, ref) {
    const localize = useLocalePath();
    return (
      <NavLink ref={ref} to={typeof to === "string" ? localize(to) : to} {...rest} />
    );
  },
);
