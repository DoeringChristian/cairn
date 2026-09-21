export default function SettingsSection({ title, first, children }: {
  title: string;
  first?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={first ? undefined : "mt-3"}>
      <h4 className="text-xs uppercase tracking-wide text-fg-muted mb-2">{title}</h4>
      {children}
    </div>
  );
}
