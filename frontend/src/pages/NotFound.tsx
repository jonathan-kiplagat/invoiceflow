import { Link } from "react-router-dom";
import { Button, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      action={<Link to="/"><Button>Back to dashboard</Button></Link>}
    />
  );
}
