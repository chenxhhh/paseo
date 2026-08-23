import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { BoardScreen } from "@/screens/board/board-screen";

export default function BoardRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <BoardScreen />
    </HostRouteBootstrapBoundary>
  );
}
