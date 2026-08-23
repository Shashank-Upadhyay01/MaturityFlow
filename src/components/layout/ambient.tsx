/** Layer 1 of the glass system — the animated colour field behind everything. */
export function AmbientField() {
  return (
    <>
      <div className="mf-field" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="mf-grain" aria-hidden />
    </>
  );
}

/**
 * Applies the saved theme before first paint so there is no flash of the wrong theme.
 * Runs inline in <head>; deliberately tiny.
 */
export function ThemeScript() {
  const code = `(function(){try{var t=localStorage.getItem('mf-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
