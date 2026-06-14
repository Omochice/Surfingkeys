{
  description = "Surfingkeys dev tooling";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            # node and pnpm only bootstrap a pnpm onto PATH; the versions that
            # actually run come from pnpm (devEngines pnpm, executionEnv.nodeVersion).
            pkgs.nodejs_24
            pkgs.pnpm
            pkgs.typos
          ];
        };
      }
    );
}
