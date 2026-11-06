export function BoxTag({ code, size = 'small' }: { code: string | null | undefined; size?: 'small' | 'large' }) {
  if (!code) {
    return (
      <span className={`box-tag box-tag-empty box-tag-${size}`}>
        <span>No box</span>
      </span>
    );
  }
  return (
    <span className={`box-tag box-tag-${size}`}>
      <span>{code}</span>
    </span>
  );
}
