"""Never-fail documentation retrieval with guaranteed content delivery."""

import asyncio
import re
from typing import Optional, Dict, Any, List
import structlog
from mcp.server.fastmcp import Context

from ..registry.manager import FrameworkRegistryManager
from ..registry.cache import DocumentationCache
from ..providers.github import GitHubProvider
from ..providers.website import WebsiteProvider

logger = structlog.get_logger(__name__)

# Comprehensive static content library for reliable fallback
COMPREHENSIVE_STATIC_DOCS = {
    "nextjs": {
        "main": """# Next.js - React Framework for Production
**Category:** web | **Type:** react-framework | **Version:** latest

## Overview
Next.js is a React framework that enables you to build full-stack web applications by extending React features and integrating powerful Rust-based JavaScript tooling for the fastest builds.

## Core Features
- **App Router**: File-based routing with layouts, nested routing, loading states, error handling, and more
- **Server Components**: Render components on the server to improve performance and SEO
- **Server Actions**: Run server code directly from React components
- **Streaming**: Stream UI from the server as it's rendered
- **Built-in Optimizations**: Image, fonts, and script optimizations out of the box
- **CSS Support**: Built-in support for CSS Modules, Sass, Tailwind CSS, and more

## Quick Start
```bash
npx create-next-app@latest my-app
cd my-app
npm run dev
```

## Project Structure (App Router)
```
my-app/
├── app/
│   ├── layout.tsx      # Root layout
│   ├── page.tsx        # Home page
│   ├── about/
│   │   └── page.tsx    # About page
│   └── api/
│       └── route.ts    # API route
├── public/             # Static assets
├── next.config.js      # Next.js config
└── package.json
```

## Basic Page Component
```typescript
// app/page.tsx
export default function Page() {
  return <h1>Hello, Next.js!</h1>
}
```

## Layout Component
```typescript
// app/layout.tsx
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

## Server Component (Default)
```typescript
// app/posts/page.tsx
async function getPosts() {
  const res = await fetch('https://api.example.com/posts')
  return res.json()
}

export default async function PostsPage() {
  const posts = await getPosts()
  
  return (
    <div>
      {posts.map((post) => (
        <article key={post.id}>
          <h2>{post.title}</h2>
          <p>{post.content}</p>
        </article>
      ))}
    </div>
  )
}
```

## Client Component
```typescript
'use client'
 
import { useState } from 'react'
 
export default function Counter() {
  const [count, setCount] = useState(0)
 
  return (
    <div>
      <p>You clicked {count} times</p>
      <button onClick={() => setCount(count + 1)}>
        Click me
      </button>
    </div>
  )
}
```

## API Route
```typescript
// app/api/users/route.ts
export async function GET() {
  const res = await fetch('https://data.mongodb-api.com/...')
  const data = await res.json()
 
  return Response.json({ data })
}

export async function POST(request: Request) {
  const res = await request.json()
  return Response.json({ res })
}
```

## Data Fetching Patterns
- **Server Components**: Fetch data directly in components
- **Route Handlers**: Create API endpoints
- **Server Actions**: Run server code from client components
- **Client-side**: Use SWR or TanStack Query for client data

## Common Patterns
- file-based-routing
- server-components
- client-components
- data-fetching
- layout-patterns
- api-routes
- middleware
- image-optimization

## Best Practices
1. Use Server Components by default
2. Only use Client Components when needed (interactivity, browser APIs)
3. Fetch data close to where it's used
4. Use TypeScript for better development experience
5. Optimize images with next/image
6. Use proper SEO with metadata API

Official Documentation: https://nextjs.org/docs""",
        
        "installation": """# Next.js Installation Guide

## System Requirements
- Node.js 18.17 or later
- macOS, Windows (including WSL), and Linux are supported

## Automatic Installation
```bash
npx create-next-app@latest my-app
cd my-app
npm run dev
```

## Interactive Setup
The installer will ask you:
- TypeScript? Yes (recommended)
- ESLint? Yes
- Tailwind CSS? Yes (recommended)
- Use src/ directory? No (App Router default)
- Use App Router? Yes (recommended)
- Customize import alias? No (use default @/*)

## Manual Installation
```bash
npm install next@latest react@latest react-dom@latest
```

Add scripts to package.json:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

## First Steps
1. Create app/layout.tsx (root layout)
2. Create app/page.tsx (home page)
3. Run `npm run dev`
4. Visit http://localhost:3000""",
        
        "routing": """# Next.js App Router

## File-based Routing
The App Router uses the file system to define routes:

```
app/
├── page.tsx           # / 
├── about/
│   └── page.tsx       # /about
├── blog/
│   ├── page.tsx       # /blog
│   └── [slug]/
│       └── page.tsx   # /blog/[slug]
└── dashboard/
    ├── layout.tsx     # Shared layout
    ├── page.tsx       # /dashboard
    └── settings/
        └── page.tsx   # /dashboard/settings
```

## Route Segments
- **page.tsx**: Makes route publicly accessible
- **layout.tsx**: Shared UI for segment and children
- **loading.tsx**: Loading UI
- **error.tsx**: Error UI
- **not-found.tsx**: Not found UI

## Dynamic Routes
```typescript
// app/blog/[slug]/page.tsx
export default function Post({ params }: { params: { slug: string } }) {
  return <h1>Post: {params.slug}</h1>
}
```

## Nested Routes
```typescript
// app/dashboard/layout.tsx
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div>
      <nav>Dashboard Navigation</nav>
      <main>{children}</main>
    </div>
  )
}
```

## Navigation
```typescript
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Link component
<Link href="/about">About</Link>

// Programmatic navigation
const router = useRouter()
router.push('/dashboard')
```"""
    },
    
    "react": {
        "main": """# React - A JavaScript Library for Building User Interfaces
**Category:** web | **Type:** library | **Version:** 18+

## Overview
React is a JavaScript library for building user interfaces, particularly web applications. It's maintained by Meta and a community of developers.

## Core Concepts
- **Components**: Reusable pieces of UI
- **JSX**: JavaScript syntax extension
- **Props**: Data passed to components
- **State**: Component data that changes over time
- **Hooks**: Functions that let you use React features

## Quick Start
```bash
npx create-react-app my-app
cd my-app
npm start
```

## Function Component
```jsx
function Welcome(props) {
  return <h1>Hello, {props.name}!</h1>;
}

// Or with arrow function
const Welcome = (props) => {
  return <h1>Hello, {props.name}!</h1>;
};
```

## State with useState
```jsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}
```

## Effects with useEffect
```jsx
import { useState, useEffect } from 'react';

function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUser() {
      try {
        const response = await fetch(`/api/users/${userId}`);
        const userData = await response.json();
        setUser(userData);
      } catch (error) {
        console.error('Error fetching user:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
  }, [userId]);

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>User not found</div>;

  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}
```

## Custom Hook
```jsx
import { useState, useEffect } from 'react';

function useCounter(initialValue = 0) {
  const [count, setCount] = useState(initialValue);
  
  const increment = () => setCount(count + 1);
  const decrement = () => setCount(count - 1);
  const reset = () => setCount(initialValue);
  
  return { count, increment, decrement, reset };
}

// Usage
function CounterComponent() {
  const { count, increment, decrement, reset } = useCounter(0);
  
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={increment}>+</button>
      <button onClick={decrement}>-</button>
      <button onClick={reset}>Reset</button>
    </div>
  );
}
```

## Context API
```jsx
import { createContext, useContext, useState } from 'react';

// Create context
const ThemeContext = createContext();

// Provider component
function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('light');
  
  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };
  
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Consumer component
function ThemedButton() {
  const { theme, toggleTheme } = useContext(ThemeContext);
  
  return (
    <button 
      onClick={toggleTheme}
      className={theme === 'light' ? 'light-theme' : 'dark-theme'}
    >
      Toggle to {theme === 'light' ? 'dark' : 'light'} theme
    </button>
  );
}
```

## Common Patterns
- functional-components
- hooks-pattern
- state-management
- component-composition
- conditional-rendering
- list-rendering
- form-handling

## Best Practices
1. Use functional components with hooks
2. Keep components small and focused
3. Use meaningful prop names
4. Handle errors with error boundaries
5. Optimize with React.memo when needed
6. Use keys properly in lists

Official Documentation: https://react.dev""",
        
        "hooks": """# React Hooks

## Built-in Hooks

### useState
```jsx
const [state, setState] = useState(initialValue);

// Counter example
const [count, setCount] = useState(0);
const increment = () => setCount(count + 1);
const incrementCallback = () => setCount(prev => prev + 1);
```

### useEffect
```jsx
// Run after every render
useEffect(() => {
  document.title = `Count: ${count}`;
});

// Run only on mount
useEffect(() => {
  console.log('Component mounted');
}, []);

// Run when dependencies change
useEffect(() => {
  console.log('Count changed:', count);
}, [count]);

// Cleanup function
useEffect(() => {
  const timer = setInterval(() => {
    console.log('Timer tick');
  }, 1000);
  
  return () => clearInterval(timer);
}, []);
```

### useContext
```jsx
const value = useContext(MyContext);
```

### useReducer
```jsx
function reducer(state, action) {
  switch (action.type) {
    case 'increment':
      return { count: state.count + 1 };
    case 'decrement':
      return { count: state.count - 1 };
    default:
      return state;
  }
}

function Counter() {
  const [state, dispatch] = useReducer(reducer, { count: 0 });
  
  return (
    <div>
      <p>Count: {state.count}</p>
      <button onClick={() => dispatch({ type: 'increment' })}>+</button>
      <button onClick={() => dispatch({ type: 'decrement' })}>-</button>
    </div>
  );
}
```

## Custom Hooks
```jsx
// useLocalStorage hook
function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  const setValue = (value) => {
    try {
      setStoredValue(value);
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  };

  return [storedValue, setValue];
}

// Usage
function Settings() {
  const [theme, setTheme] = useLocalStorage('theme', 'light');
  
  return (
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      Current theme: {theme}
    </button>
  );
}
```"""
    },
    
    "tailwindcss": {
        "main": """# Tailwind CSS - Utility-First CSS Framework
**Category:** web | **Type:** css-framework | **Version:** 3.x

## Overview
Tailwind CSS is a utility-first CSS framework that provides low-level utility classes to build custom designs directly in your markup.

## Core Philosophy
Instead of opinionated prebuilt components, Tailwind provides utility classes that you combine to create any design:
- `flex` for flexbox
- `pt-4` for padding-top: 1rem
- `text-center` for text-align: center
- `rotate-90` for transform: rotate(90deg)

## Installation

### Via CDN (Quick Start)
```html
<script src="https://cdn.tailwindcss.com"></script>
```

### Via Package Manager
```bash
npm install -D tailwindcss
npx tailwindcss init
```

tailwind.config.js:
```js
module.exports = {
  content: ["./src/**/*.{html,js}"],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

## Basic Example
```html
<div class="max-w-sm mx-auto bg-white rounded-xl shadow-lg overflow-hidden md:max-w-2xl">
  <div class="md:flex">
    <div class="md:shrink-0">
      <img class="h-48 w-full object-cover md:h-full md:w-48" src="/img/building.jpg" alt="Modern building architecture">
    </div>
    <div class="p-8">
      <div class="uppercase tracking-wide text-sm text-indigo-500 font-semibold">Company retreats</div>
      <a href="#" class="block mt-1 text-lg leading-tight font-medium text-black hover:underline">Incredible accommodation for your team</a>
      <p class="mt-2 text-slate-500">Looking to take your team away on a retreat to enjoy awesome food and take in some sunshine? We have a list of places to do just that.</p>
    </div>
  </div>
</div>
```

## Layout
```html
<!-- Flexbox -->
<div class="flex items-center justify-center h-screen">
  <div class="text-center">Content</div>
</div>

<!-- Grid -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <div class="bg-blue-500 p-4">Item 1</div>
  <div class="bg-green-500 p-4">Item 2</div>
  <div class="bg-red-500 p-4">Item 3</div>
</div>

<!-- Container -->
<div class="container mx-auto px-4">
  <h1 class="text-3xl font-bold">Title</h1>
</div>
```

## Spacing
```html
<!-- Padding -->
<div class="p-4">All sides: 1rem</div>
<div class="px-4 py-2">Horizontal: 1rem, Vertical: 0.5rem</div>
<div class="pt-8 pr-6 pb-4 pl-2">Individual sides</div>

<!-- Margin -->
<div class="m-4">All sides: 1rem</div>
<div class="mx-auto">Horizontal: auto (center)</div>
<div class="mt-8 mb-4">Top: 2rem, Bottom: 1rem</div>
```

## Typography
```html
<!-- Font Size -->
<h1 class="text-4xl font-bold">Large heading</h1>
<p class="text-base">Normal text</p>
<small class="text-sm text-gray-600">Small text</small>

<!-- Font Weight -->
<p class="font-light">Light text</p>
<p class="font-normal">Normal text</p>
<p class="font-semibold">Semibold text</p>
<p class="font-bold">Bold text</p>

<!-- Text Color -->
<p class="text-gray-900">Dark text</p>
<p class="text-blue-600">Blue text</p>
<p class="text-red-500">Red text</p>
```

## Colors & Backgrounds
```html
<!-- Background Colors -->
<div class="bg-blue-500">Blue background</div>
<div class="bg-gradient-to-r from-purple-400 to-pink-400">Gradient</div>

<!-- Text Colors -->
<p class="text-blue-600">Blue text</p>
<p class="text-gray-800 dark:text-gray-200">Dark mode responsive</p>
```

## Responsive Design
```html
<!-- Mobile first approach -->
<div class="w-full md:w-1/2 lg:w-1/3 xl:w-1/4">
  <!-- 100% width on mobile, 50% on md+, 33% on lg+, 25% on xl+ -->
</div>

<!-- Hide/show at breakpoints -->
<div class="block md:hidden">Mobile only</div>
<div class="hidden md:block">Desktop only</div>
```

## Dark Mode
```html
<div class="bg-white dark:bg-gray-800">
  <h1 class="text-gray-900 dark:text-white">Heading</h1>
  <p class="text-gray-700 dark:text-gray-300">Content</p>
</div>
```

## States & Interactions
```html
<!-- Hover -->
<button class="bg-blue-500 hover:bg-blue-700 text-white px-4 py-2 rounded">
  Hover me
</button>

<!-- Focus -->
<input class="border focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200">

<!-- Active -->
<button class="bg-blue-500 active:bg-blue-800">Click me</button>
```

## Common Components

### Button
```html
<button class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
  Button
</button>
```

### Card
```html
<div class="max-w-sm rounded overflow-hidden shadow-lg">
  <img class="w-full" src="image.jpg" alt="Image">
  <div class="px-6 py-4">
    <div class="font-bold text-xl mb-2">Card Title</div>
    <p class="text-gray-700 text-base">Card content</p>
  </div>
</div>
```

### Form
```html
<form class="space-y-4">
  <div>
    <label class="block text-sm font-medium text-gray-700">Email</label>
    <input type="email" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
  </div>
  <button type="submit" class="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700">
    Submit
  </button>
</form>
```

## Customization
tailwind.config.js:
```js
module.exports = {
  theme: {
    extend: {
      colors: {
        'brand': {
          50: '#eff6ff',
          500: '#3b82f6',
          900: '#1e3a8a',
        }
      },
      fontFamily: {
        'brand': ['Inter', 'sans-serif']
      }
    }
  }
}
```

Official Documentation: https://tailwindcss.com/docs""",
        
        "responsive": """# Tailwind CSS Responsive Design

## Breakpoints
```
sm: 640px   # Small devices
md: 768px   # Medium devices  
lg: 1024px  # Large devices
xl: 1280px  # Extra large devices
2xl: 1536px # 2X Large devices
```

## Mobile-First Approach
```html
<!-- This div will be:
     - w-full (100% width) on mobile
     - w-1/2 (50% width) on md screens and up
     - w-1/3 (33% width) on lg screens and up -->
<div class="w-full md:w-1/2 lg:w-1/3">
  Responsive content
</div>
```

## Common Responsive Patterns
```html
<!-- Responsive Grid -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <div>Item 1</div>
  <div>Item 2</div>  
  <div>Item 3</div>
</div>

<!-- Responsive Typography -->
<h1 class="text-2xl md:text-4xl lg:text-6xl">
  Responsive heading
</h1>

<!-- Hide/Show Elements -->
<nav class="block md:hidden">Mobile nav</nav>
<nav class="hidden md:block">Desktop nav</nav>

<!-- Responsive Spacing -->
<div class="p-4 md:p-8 lg:p-12">
  Content with responsive padding
</div>
```"""
    },
    
    "fastapi": {
        "main": """# FastAPI - Modern Python Web Framework
**Category:** backend | **Type:** web-framework | **Version:** 0.100+

## Overview
FastAPI is a modern, fast (high-performance) web framework for building APIs with Python 3.8+ based on standard Python type hints.

## Key Features
- **Fast**: Very high performance, on par with NodeJS and Go
- **Fast to code**: Increase development speed by 200% to 300%
- **Fewer bugs**: Reduce human errors by about 40%
- **Intuitive**: Great editor support with autocompletion
- **Easy**: Designed to be easy to use and learn
- **Short**: Minimize code duplication
- **Robust**: Get production-ready code with automatic interactive documentation
- **Standards-based**: Based on OpenAPI and JSON Schema

## Installation
```bash
pip install fastapi
pip install "uvicorn[standard]"
```

## Quick Start
```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def read_root():
    return {"Hello": "World"}

@app.get("/items/{item_id}")
async def read_item(item_id: int, q: str | None = None):
    return {"item_id": item_id, "q": q}
```

Run with:
```bash
uvicorn main:app --reload
```

## Path Parameters
```python
@app.get("/items/{item_id}")
async def read_item(item_id: int):
    return {"item_id": item_id}

# With type validation
@app.get("/users/{user_id}")
async def read_user(user_id: int):
    if user_id < 1:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    return {"user_id": user_id}
```

## Query Parameters
```python
from typing import Union

@app.get("/items/")
async def read_items(skip: int = 0, limit: int = 10, q: Union[str, None] = None):
    items = fake_items_db[skip: skip + limit]
    if q:
        items = [item for item in items if q.lower() in item["name"].lower()]
    return items
```

## Request Body with Pydantic
```python
from pydantic import BaseModel
from typing import Union

class Item(BaseModel):
    name: str
    description: Union[str, None] = None
    price: float
    tax: Union[float, None] = None

@app.post("/items/")
async def create_item(item: Item):
    return {"message": f"Item {item.name} created", "item": item}

@app.put("/items/{item_id}")
async def update_item(item_id: int, item: Item):
    return {"item_id": item_id, "item": item}
```

## Form Data
```python
from fastapi import Form

@app.post("/login/")
async def login(username: str = Form(), password: str = Form()):
    return {"username": username}
```

## File Upload
```python
from fastapi import File, UploadFile

@app.post("/uploadfile/")
async def create_upload_file(file: UploadFile = File()):
    return {"filename": file.filename, "size": len(await file.read())}
```

## Dependency Injection
```python
from fastapi import Depends

async def common_parameters(q: str | None = None, skip: int = 0, limit: int = 100):
    return {"q": q, "skip": skip, "limit": limit}

@app.get("/items/")
async def read_items(commons: dict = Depends(common_parameters)):
    return commons

@app.get("/users/")  
async def read_users(commons: dict = Depends(common_parameters)):
    return commons
```

## Database Integration
```python
from sqlalchemy.orm import Session
from fastapi import Depends
import crud, models, schemas
from database import SessionLocal, engine

models.Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.post("/users/", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    return crud.create_user(db=db, user=user)

@app.get("/users/", response_model=list[schemas.User])
def read_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    users = crud.get_users(db, skip=skip, limit=limit)
    return users
```

## Authentication
```python
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt

security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return username
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

@app.get("/protected/")
async def protected_route(current_user: str = Depends(verify_token)):
    return {"message": f"Hello {current_user}"}
```

## Error Handling
```python
from fastapi import HTTPException

@app.get("/items/{item_id}")
async def read_item(item_id: str):
    if item_id not in items:
        raise HTTPException(
            status_code=404, 
            detail="Item not found",
            headers={"X-Error": "Item not found"},
        )
    return {"item": items[item_id]}
```

## Background Tasks
```python
from fastapi import BackgroundTasks

def write_notification(email: str, message=""):
    with open("log.txt", mode="w") as email_file:
        content = f"notification for {email}: {message}"
        email_file.write(content)

@app.post("/send-notification/{email}")
async def send_notification(email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(write_notification, email, message="some notification")
    return {"message": "Notification sent in the background"}
```

## CORS
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://example.com", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Testing
```python
from fastapi.testclient import TestClient
import pytest

client = TestClient(app)

def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"Hello": "World"}

def test_create_item():
    response = client.post(
        "/items/",
        json={"name": "Test Item", "price": 10.5},
    )
    assert response.status_code == 200
    assert response.json()["item"]["name"] == "Test Item"
```

## Common Patterns
- request-response-models
- dependency-injection
- async-endpoints
- middleware-patterns
- background-tasks
- database-integration
- authentication-patterns

Official Documentation: https://fastapi.tiangolo.com""",
        
        "async": """# FastAPI Async Programming

## Async Endpoints
```python
import asyncio
import aiohttp
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def read_root():
    # Async I/O operation
    await asyncio.sleep(1)
    return {"message": "Hello World"}

@app.get("/fetch-data/")
async def fetch_external_data():
    async with aiohttp.ClientSession() as session:
        async with session.get("https://api.example.com/data") as response:
            data = await response.json()
            return data
```

## Database Operations
```python
import asyncpg
from fastapi import FastAPI

app = FastAPI()

@app.on_event("startup")
async def startup():
    app.state.pool = await asyncpg.create_pool(
        "postgresql://user:password@localhost/dbname"
    )

@app.get("/users/{user_id}")
async def get_user(user_id: int):
    async with app.state.pool.acquire() as connection:
        user = await connection.fetchrow(
            "SELECT * FROM users WHERE id = $1", user_id
        )
        return dict(user) if user else {"error": "User not found"}
```"""
    }
}

async def get_framework_docs_never_fail(
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    github_provider: GitHubProvider,
    website_provider: WebsiteProvider,
    framework: str,
    section: Optional[str] = None,
    use_cache: bool = True,
    ctx: Optional[Context] = None
) -> str:
    """Never-fail documentation retrieval with guaranteed content delivery.
    
    This function implements a comprehensive fallback strategy:
    1. Try cache (fast path)
    2. Try fresh fetch with retries (reliable path)  
    3. Use comprehensive static content (guaranteed path)
    4. Return framework info as last resort (never empty)
    
    Users will ALWAYS get useful documentation content.
    """
    if ctx:
        await ctx.info(f"Retrieving documentation for {framework}" + 
                      (f" (section: {section})" if section else ""))
    
    framework_key = framework.lower()
    
    # Step 1: Try cache first (fastest path)
    cached_content = await _try_cache_retrieval(
        cache, framework, section, use_cache, ctx
    )
    if cached_content:
        return cached_content
    
    # Step 2: Try comprehensive fresh fetch with retries (reliable path)
    fresh_content = await _try_fresh_fetch_with_retries(
        registry, github_provider, website_provider, framework, section, ctx
    )
    if fresh_content:
        # Cache the successful result for future requests
        if use_cache and cache:
            try:
                await cache.set(
                    framework=framework,
                    content=fresh_content,
                    path=section or "",
                    source_type="docs",
                    version="latest"
                )
                logger.info("Fresh content cached successfully", framework=framework)
            except Exception as e:
                logger.warning("Failed to cache fresh content", error=str(e))
        return fresh_content
    
    # Step 3: Use comprehensive static content (guaranteed path)
    static_content = _get_static_content(framework_key, section)
    if static_content:
        if ctx:
            await ctx.info("Using comprehensive static documentation content")
        logger.info("Serving static fallback content", framework=framework)
        return static_content
    
    # Step 4: Return framework-aware help (never fail path)
    return _generate_framework_guidance(framework, section, registry)


async def _try_cache_retrieval(
    cache: DocumentationCache, 
    framework: str, 
    section: Optional[str], 
    use_cache: bool, 
    ctx: Optional[Context]
) -> Optional[str]:
    """Try to retrieve content from cache."""
    if not use_cache or not cache:
        return None
    
    try:
        cached_content = await cache.get(framework, section or "", "docs")
        if cached_content:
            logger.debug("Documentation retrieved from cache", framework=framework)
            if ctx:
                await ctx.debug("Using cached documentation")
            return cached_content
    except Exception as e:
        logger.warning("Cache retrieval failed", framework=framework, error=str(e))
    
    return None


async def _try_fresh_fetch_with_retries(
    registry: FrameworkRegistryManager,
    github_provider: GitHubProvider,
    website_provider: WebsiteProvider,
    framework: str,
    section: Optional[str],
    ctx: Optional[Context],
    max_retries: int = 3
) -> Optional[str]:
    """Try fresh fetch from multiple sources with retry logic."""
    if not registry:
        return None
    
    config = registry.get_framework(framework)
    if not config:
        logger.debug("Framework not in registry", framework=framework)
        return None
    
    if ctx:
        await ctx.report_progress(0.2, 1.0, "Fetching from external sources")
    
    # Try multiple sources with retries
    sources_to_try = []
    
    # Add GitHub source
    if config.sources.documentation.github and github_provider:
        sources_to_try.append(("github", config.sources.documentation.github))
    
    # Add website source  
    if config.sources.documentation.website and website_provider:
        sources_to_try.append(("website", config.sources.documentation.website))
    
    documentation_parts = []
    
    for source_type, source_config in sources_to_try:
        for attempt in range(max_retries):
            try:
                if ctx:
                    await ctx.debug(f"Fetching from {source_type} (attempt {attempt + 1}/{max_retries})")
                
                content = None
                if source_type == "github":
                    content = await github_provider.fetch_documentation(
                        repo=source_config.repo,
                        path=section or source_config.docs_path,
                        branch=source_config.branch
                    )
                elif source_type == "website":
                    website_url = str(source_config)
                    if section:
                        if not website_url.endswith('/'):
                            website_url += '/'
                        website_url += section
                    content = await website_provider.fetch_documentation(website_url)
                
                if content:
                    documentation_parts.append({
                        "source": source_type.title(),
                        "content": content,
                        "config": source_config
                    })
                    logger.info(f"Successfully fetched from {source_type}", 
                               framework=framework, attempt=attempt + 1)
                    break  # Success, no need to retry this source
                    
            except Exception as e:
                logger.warning(f"Attempt {attempt + 1} failed for {source_type}",
                              framework=framework, error=str(e))
                if attempt < max_retries - 1:
                    # Wait before retry with exponential backoff
                    wait_time = 0.5 * (2 ** attempt)
                    await asyncio.sleep(wait_time)
                else:
                    logger.error(f"All attempts failed for {source_type}",
                                framework=framework, error=str(e))
    
    # Format and return content if we got any
    if documentation_parts:
        if ctx:
            await ctx.report_progress(0.8, 1.0, "Processing documentation")
        
        try:
            formatted_docs = await _format_documentation_comprehensive(
                framework, documentation_parts, config
            )
            logger.info("Fresh documentation formatted successfully",
                       framework=framework, sources=len(documentation_parts))
            return formatted_docs
        except Exception as e:
            logger.error("Failed to format fresh documentation", 
                        framework=framework, error=str(e))
    
    return None


def _get_static_content(framework_key: str, section: Optional[str]) -> Optional[str]:
    """Get comprehensive static content for the framework."""
    if framework_key not in COMPREHENSIVE_STATIC_DOCS:
        return None
    
    framework_docs = COMPREHENSIVE_STATIC_DOCS[framework_key]
    
    # If section is requested and available, return that specific section
    if section and section in framework_docs:
        return framework_docs[section]
    
    # Otherwise return main documentation
    return framework_docs.get("main")


def _generate_framework_guidance(
    framework: str, 
    section: Optional[str], 
    registry: Optional[FrameworkRegistryManager]
) -> str:
    """Generate helpful guidance when no documentation is available."""
    
    response = f"# {framework.title()} Framework Information\n\n"
    
    # Try to get basic info from registry
    if registry:
        config = registry.get_framework(framework)
        if config:
            response += f"**Category:** {config.category} | **Type:** {config.type}\n\n"
            
            if config.key_features:
                response += "## Known Features\n"
                for feature in config.key_features:
                    response += f"- {feature}\n"
                response += "\n"
            
            if config.common_patterns:
                response += "## Common Patterns\n"
                for pattern in config.common_patterns:
                    response += f"- {pattern}\n"
                response += "\n"
    
    response += "## What I can help with:\n"
    response += "Even without cached documentation, I can assist with:\n\n"
    response += f"1. **General Questions**: Ask me about {framework} concepts, patterns, or best practices\n"
    response += f"2. **Code Examples**: Request specific examples like 'Show me a {framework} component example'\n"
    response += f"3. **Getting Started**: Ask 'How do I get started with {framework}?'\n"
    response += "4. **Problem Solving**: Describe what you're trying to build and I'll help\n"
    response += f"5. **Code Review**: Share your {framework} code for feedback and improvements\n\n"
    
    if section:
        response += f"**Note**: You requested the '{section}' section specifically. "
        response += f"Try asking more specific questions about {section} in {framework}.\n\n"
    
    response += "## Alternative Approaches\n"
    response += "Instead of requesting documentation, try:\n"
    response += f"- 'Create a {framework} example for [your specific use case]'\n"
    response += f"- 'How do I [specific task] in {framework}?'\n"
    response += f"- 'What's the best way to [goal] using {framework}?'\n"
    response += f"- 'Show me {framework} code that [does something specific]'\n\n"
    
    response += "*I'm designed to be helpful even when external documentation isn't available. "
    response += "My training data includes extensive knowledge about popular frameworks.*"
    
    return response


async def _format_documentation_comprehensive(
    framework: str,
    documentation_parts: List[Dict[str, Any]],
    config: Any
) -> str:
    """Format documentation with comprehensive structure."""
    
    formatted_parts = []
    
    # Add comprehensive header
    formatted_parts.append(f"# {config.display_name} Documentation")
    formatted_parts.append(f"**Category:** {config.category} | **Type:** {config.type} | **Version:** {config.version}")
    formatted_parts.append(f"**Last Updated:** {asyncio.get_event_loop().time()}")
    formatted_parts.append("")
    
    # Add framework overview
    if config.key_features:
        formatted_parts.append("## Key Features")
        for feature in config.key_features:
            formatted_parts.append(f"- {feature}")
        formatted_parts.append("")
    
    # Add sourced documentation content
    for i, part in enumerate(documentation_parts):
        source_name = part['source']
        if len(documentation_parts) > 1:
            formatted_parts.append(f"## Documentation Source: {source_name}")
            if 'config' in part:
                config_info = part['config']
                if hasattr(config_info, 'repo'):
                    formatted_parts.append(f"**Repository:** {config_info.repo}")
                elif isinstance(config_info, str):
                    formatted_parts.append(f"**URL:** {config_info}")
            formatted_parts.append("")
        
        # Clean and format the content
        content = part['content']
        content = _clean_and_enhance_content(content)
        formatted_parts.append(content)
        formatted_parts.append("")
    
    # Add patterns and additional info
    if config.common_patterns:
        formatted_parts.append("## Common Patterns")
        for pattern in config.common_patterns:
            formatted_parts.append(f"- {pattern}")
        formatted_parts.append("")
    
    # Add footer with helpful notes
    formatted_parts.append("---")
    formatted_parts.append("*This documentation was fetched from live sources. "
                          "If you have specific questions or need examples, "
                          "feel free to ask for more targeted help.*")
    
    return "\n".join(formatted_parts)


def _clean_and_enhance_content(content: str) -> str:
    """Clean and enhance markdown content with better formatting."""
    if not content:
        return ""
    
    # Remove excessive whitespace
    content = re.sub(r'\n\s*\n\s*\n+', '\n\n', content)
    
    # Fix heading levels to ensure proper hierarchy
    lines = content.split('\n')
    min_heading_level = float('inf')
    
    # Find minimum heading level
    for line in lines:
        if line.strip().startswith('#'):
            level = len(line) - len(line.lstrip('#'))
            if level > 0:
                min_heading_level = min(min_heading_level, level)
    
    # Adjust headings if needed
    if min_heading_level > 1 and min_heading_level != float('inf'):
        adjustment = min_heading_level - 1
        adjusted_lines = []
        for line in lines:
            if line.strip().startswith('#'):
                level = len(line) - len(line.lstrip('#'))
                new_level = max(1, level - adjustment)
                new_line = '#' * new_level + line.lstrip('#')
                adjusted_lines.append(new_line)
            else:
                adjusted_lines.append(line)
        content = '\n'.join(adjusted_lines)
    
    # Ensure code blocks are properly formatted
    content = re.sub(r'```(\w*)\n', r'```\1\n', content)
    
    # Remove trailing whitespace from lines
    content = '\n'.join(line.rstrip() for line in content.split('\n'))
    
    return content.strip()