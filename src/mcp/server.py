from fastmcp import FastMCP

mcp = FastMCP("pkm")


@mcp.tool
def ping() -> str:
    return "pong"


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
