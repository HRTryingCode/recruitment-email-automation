import { Link } from 'react-router-dom';
import { ArrowLeft, FileQuestion } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestion />
          </EmptyMedia>
          <Badge variant="outline">Error 404</Badge>
          <EmptyTitle>
            <h1>Page not found</h1>
          </EmptyTitle>
          <EmptyDescription>The page you’re looking for doesn’t exist or has been moved.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link to="/">
              <ArrowLeft data-icon="inline-start" />
              Back to Inbox
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
