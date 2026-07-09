/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Tableau loads the extension inside an iframe - allow that.
        source: "/extension/:path*",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *;" }
        ]
      }
    ];
  }
};

export default nextConfig;
