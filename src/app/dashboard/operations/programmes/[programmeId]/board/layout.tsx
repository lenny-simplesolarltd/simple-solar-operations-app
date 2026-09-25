/**
 * The board and, over it, whatever the @modal slot is showing.
 *
 * The slot exists so a card can open its visit without leaving the board. It is
 * empty (default.tsx) on every URL except an intercepted /visits/[visitId].
 */
export default function BoardLayout({
  children,
  modal
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
