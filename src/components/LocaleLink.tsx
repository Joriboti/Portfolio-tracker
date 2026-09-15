import { forwardRef } from "react";
import {
  Link,
  NavLink,
  useLocation,
  type LinkProps,
  type NavLinkProps,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LOCALES,
  isLocalizable,
  localeFromPath,
  stripLocale,
  withLocale,
  type Locale,
} from "@/lib/locale";

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

/**
 * The locale of the page currently rendered, read from the URL. On the
 * language-neutral app pages (/dashboard, /upload, …) the URL carries no
 * locale, so the UI language stands in: otherwise every link out of the
 * English dashboard pointed at the Catalan tree.
 */
export function useLocale(): Locale {
  const { pathname } = useLocation();
  const { i18n } = useTranslation();
  if (!isLocalizable(stripLocale(pathname))) {
    const ui = i18n.language?.slice(0, 2);
    if (ui && (LOCALES as readonly string[]).includes(ui)) return ui as Locale;
  }
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
