export function allowsUnauthenticatedPath(pathname: string) {
  if (pathname === "/") {
    return true;
  }

  if (pathname.startsWith("/login") || pathname.startsWith("/auth")) {
    return true;
  }

  return (
    pathname === "/invitations/accept" ||
    pathname.startsWith("/invitations/accept/")
  );
}
