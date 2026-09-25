export function allowsUnauthenticatedPath(pathname: string) {
  if (pathname === "/") {
    return true;
  }

  if (pathname.startsWith("/login") || pathname.startsWith("/auth")) {
    return true;
  }

  if (pathname === "/kiosk" || pathname.startsWith("/kiosk/")) {
    return true;
  }

  if (pathname === "/docs" || pathname.startsWith("/docs/")) {
    return true;
  }

  return (
    pathname === "/invitations/accept" ||
    pathname.startsWith("/invitations/accept/")
  );
}
