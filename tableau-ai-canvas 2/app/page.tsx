export default function Home() {
  return (
    <main style={{ padding: 40 }}>
      <h1>Tableau AI Canvas</h1>
      <p>
        This app is meant to be loaded as a Tableau Dashboard Extension, not visited directly.
        Point your <code>.trex</code> manifest&apos;s <code>source-location</code> at{" "}
        <code>/extension</code>.
      </p>
    </main>
  );
}
