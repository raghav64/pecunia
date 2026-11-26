/** Analysis pages not yet ported to React: the classic report, embedded without its own header. */
export default function Legacy({ page, reloadKey, dark }: { page: string; reloadKey: number; dark: boolean }) {
  return (
    <iframe
      key={`${page}-${reloadKey}-${dark}`}
      src={`/legacy#/${page}`}
      title={page}
      className="block h-screen w-full border-0"
    />
  );
}
