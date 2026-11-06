// Deal-team memberships the Google Sheet sync used to add on its own: when it
// created a deal it put whoever approved the import on the team as lead with
// 40%. Those are recognisable: a deal created from the sheet (sheetKey set),
// the membership created in the same instant as the deal, for its creator.
type MemberLike = { userId: string; createdAt: string };
type DealLike = { sheetKey: string | null; createdAt: string; createdBy: string | null };

export function isSheetAutoMembership(m: MemberLike, d: DealLike): boolean {
  return !!d.sheetKey && m.userId === d.createdBy && m.createdAt === d.createdAt;
}
