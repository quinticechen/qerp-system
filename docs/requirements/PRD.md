# Textile ERP System - Product Requirements Document (PRD)

> Requirement document: the project's original product requirements (2025-08). The parts below have been superseded by later decisions; for the current state, follow the documents on the right:
>
> - Roles and permissions (§1.3, §2.2, §3.9, §6.3): changed to fixed owner, admin, editor and viewer roles, with no custom roles → [MULTI_TENANT_RBAC.md](./MULTI_TENANT_RBAC.md), [PERMISSIONS.md](../PERMISSIONS.md)
> - Technology choices and architecture (§5, §6): Zustand and Edge Functions are not used; business logic lives in database functions → [TECH_STACK.md](../TECH_STACK.md)
> - Data model (§7) → [DATABASE_TABLES.md](../DATABASE_TABLES.md); current features → [FEATURES.md](../FEATURES.md)

## 1. Product overview

### 1.1 Product name
Multi-tenant organization ERP management system for the textile industry

### 1.2 Product vision
Build a comprehensive, multi-tenant enterprise resource planning system for the textile industry, with organization-level permission management, so textile businesses of any size can manage their business processes efficiently.

### 1.3 Target users

#### 1.3.1 Organization-level users
- **Organization owner**: the head of the business, with the highest permissions in the organization
- **Organization admin**: a senior manager responsible for day-to-day management of the organization
- **Department head**: the head of each department, with permissions related to their department

#### 1.3.2 Functional-role users
- **Sales**: maintains customer relationships, handles orders
- **Purchasing**: handles raw material purchasing and supplier management
- **Warehouse manager**: manages inventory, receiving and shipping operations
- **Production assistant**: helps carry out production plans and enters data
- **Accountant**: views finance-related data

### 1.4 Core value proposition
- **Multi-tenant architecture**: multiple organizations operate independently with fully isolated data
- **Flexible permission management**: organization-level custom roles and permission settings
- **End-to-end coverage**: complete business process management from order to shipping
- **Real-time inventory tracking**: accurate inventory quantity and quality management
- **Smart alerts**: automatic reminders for low stock, expiry, etc.
- **Data security**: RLS-based data isolation and security controls

## 2. Organization structure requirements

### 2.1 Multi-tenant organization model

#### 2.1.1 Organization management
- **Create organization**: users can create a new organization and automatically become its owner
- **Organization settings**: configure basic organization information and preferences
- **Switch organization**: users can switch between several organizations
- **Organization invitations**: the organization owner can invite new users to join

#### 2.1.2 User management
- **Membership in several organizations**: a user can belong to several organizations
- **Organization roles**: each user can have a different role in each organization
- **Permission inheritance**: automatic role-based permission inheritance

### 2.2 Permission architecture

#### 2.2.1 Three-layer permission model
```
Organization-level permissions
├── Organization management permissions (organization owner / admin)
├── Feature module permissions (assigned by role)
└── Data access permissions (based on organization membership)
```

#### 2.2.2 Default roles
- **Organization owner**: all permissions in the organization
- **Admin**: most feature permissions, no organization management permissions
- **Sales**: customer and order permissions
- **Assistant**: most operation permissions, no delete permission
- **Accountant**: mainly view permissions, a few edit permissions
- **Warehouse manager**: inventory and shipping permissions

#### 2.2.3 Custom roles
- **Create roles**: the organization owner can create custom roles
- **Configure permissions**: flexible combinations of permissions
- **Assign roles**: assign custom roles to organization members

## 3. Functional requirements (PFR)

### 3.1 Organization management module

#### 3.1.1 Basic organization management
- **F001**: Create an organization and set basic information
- **F002**: Organization settings management (preferences, configuration, etc.)
- **F003**: Invite and manage organization members
- **F004**: Manage organization roles and permissions

#### 3.1.2 User authentication flow
- **F005**: Check and select an organization after sign-in
- **F006**: Direct users without an organization to the create-organization flow
- **F007**: Organization switching for users in several organizations

### 3.2 Product management module

#### 3.2.1 Basic product data
- **F101**: Add, edit and delete products
- **F102**: Product category management (fabric type, specification, etc.)
- **F103**: Upload and manage product images
- **F104**: Product status management (available, discontinued, etc.)
- **F105**: Set stock thresholds and alerts

#### 3.2.2 Product specification management
- **F106**: Define fabric specifications (width, composition, weight per area, etc.)
- **F107**: Color code management
- **F108**: Quality grade classification (A, B, C, D, defective)

### 3.3 Customer management module

#### 3.3.1 Basic customer data
- **F201**: Add, edit and delete customers
- **F202**: Customer contact information management
- **F203**: Customer categories and tags
- **F204**: View a customer's order history

### 3.4 Factory management module

#### 3.4.1 Basic factory data
- **F301**: Add, edit and delete factories
- **F302**: Factory contact information and address management
- **F303**: Factory capacity and specialty settings

### 3.5 Order management module

#### 3.5.1 Order process
- **F401**: Create and edit orders
- **F402**: Order status tracking (pending, in production, completed, etc.)
- **F403**: Order line management
- **F404**: Link orders to factories
- **F405**: Order shipping status management

#### 3.5.2 Advanced order features
- **F406**: Automatic order number generation
- **F407**: Order payment status tracking
- **F408**: Order notes and special requirements

### 3.6 Purchasing module

#### 3.6.1 Purchase order processing
- **F501**: Create and edit purchase orders
- **F502**: Purchase order status management
- **F503**: Purchase order lines and specifications
- **F504**: Link to customer orders
- **F505**: Automatic purchase order number generation

#### 3.6.2 Advanced purchasing features
- **F506**: Expected arrival date management
- **F507**: Purchase cost calculation and recording

### 3.7 Inventory module

#### 3.7.1 Receiving
- **F601**: Register received rolls
- **F602**: Roll numbering and location management
- **F603**: Quality grading and recording
- **F604**: Record received quantities and specifications

#### 3.7.2 Inventory queries and statistics
- **F605**: Real-time inventory queries
- **F606**: Inventory statistics by product and quality grade
- **F607**: Inventory alerts and reminders
- **F608**: View inventory history

#### 3.7.3 Inventory allocation
- **F609**: Pre-allocate rolls
- **F610**: Inventory lock and release

### 3.8 Shipping module

#### 3.8.1 Shipping process
- **F701**: Create and edit shippings
- **F702**: Select and allocate rolls
- **F703**: Confirm and record shipped quantities
- **F704**: Automatic stock deduction

#### 3.8.2 Shipping tracking
- **F705**: Shipping status updates
- **F706**: Shipping history
- **F707**: Automatic shipping number generation

### 3.9 Permission management module

#### 3.9.1 Organization role management
- **F801**: View and manage organization roles
- **F802**: Create and edit custom roles
- **F803**: Set and assign role permissions
- **F804**: Manage user role assignments

#### 3.9.2 Permission control
- **F805**: Role-based feature access control
- **F806**: Data viewing permission control
- **F807**: Dynamic checks of operation permissions

### 3.10 System settings module

#### 3.10.1 Organization preferences
- **F901**: Basic organization information settings
- **F902**: System preferences and configuration
- **F903**: Notification and reminder settings

## 4. Non-functional requirements (NFR)

### 4.1 Performance
- **NFR001**: Page load time < 3 seconds
- **NFR002**: API response time < 500ms
- **NFR003**: Support 100+ concurrent online users
- **NFR004**: Optimized database queries, complex queries < 2 seconds

### 4.2 Availability
- **NFR005**: System availability ≥ 99.5%
- **NFR006**: 24/7 operation
- **NFR007**: Automatic error recovery
- **NFR008**: Data backup and disaster recovery

### 4.3 Security
- **NFR009**: Full isolation of organization data
- **NFR010**: RLS-based database security controls
- **NFR011**: JWT token authentication
- **NFR012**: HTTPS encrypted transport
- **NFR013**: Dynamic verification of role permissions

### 4.4 Scalability
- **NFR014**: Horizontally scalable architecture
- **NFR015**: Modular design, easy to extend with features
- **NFR016**: Multi-organization tenant model
- **NFR017**: API design that supports future third-party integration

### 4.5 User experience
- **NFR018**: Responsive design with mobile support
- **NFR019**: Intuitive user interface design
- **NFR020**: Complete error messages and help
- **NFR021**: Chinese interface and localization

## 5. Technology choices

### 5.1 Frontend stack
- **Framework**: React 18 + TypeScript
- **Build tool**: Vite
- **UI framework**: Tailwind CSS + shadcn/ui
- **State management**: React Query + Zustand
- **Routing**: React Router
- **Forms**: React Hook Form + Zod

### 5.2 Backend stack
- **BaaS platform**: Supabase
- **Database**: PostgreSQL (hosted by Supabase)
- **Authentication**: Supabase Auth
- **File storage**: Supabase Storage
- **Real-time**: Supabase Realtime

### 5.3 Deployment and operations
- **Frontend deployment**: Vercel
- **Backend services**: Supabase cloud
- **Monitoring**: Supabase built-in monitoring
- **CI/CD**: GitHub Actions

### 5.4 Development tools
- **Version control**: Git + GitHub
- **Code quality**: ESLint + Prettier
- **Testing**: Jest + React Testing Library
- **API testing**: Supabase testing tools

## 6. System architecture

### 6.1 Multi-tenant architecture
```
User → Select organization → Organization context → Permission check → Feature access
                ↓
        Data isolation (RLS) → Organization data → Business logic
```

### 6.2 Data isolation strategy
- **Row-level security (RLS)**: ensures organization data isolation
- **Organization ID filtering**: every business query automatically filters by organization
- **Dynamic permission checks**: permission verification based on the user's organization role

### 6.3 Permission inheritance model
```
Organization owner (all permissions)
    ↓
System roles (default permission configuration)
    ↓
Custom roles (flexible permission combinations)
    ↓
User permissions (aggregate of role permissions)
```

## 7. Data model

### 7.1 Organization entities
- **Organizations**: main organization table
- **UserOrganizations**: user–organization links
- **OrganizationRoles**: organization role definitions
- **UserOrganizationRoles**: user role assignments

### 7.2 Business entity relationships
- Every business entity has an `organization_id` column
- RLS policies ensure data isolation
- Cross-organization data queries are supported (where permissions allow)

## 8. AI Agent "Query" requirements

### 8.1 Overview

Query is an AI chat assistant embedded in the ERP system, presented as a textile-industry mascot (brand identity: manta ray). After signing in, users can call Query from any page and carry out ERP operations in natural Traditional Chinese, without browsing through each feature module by hand.

### 8.2 User experience requirements

#### 8.2.1 Entry point
- **QA-UX001**: A fixed floating button (bottom right) across the whole system; clicking it opens the Query chat window
- **QA-UX002**: The chat window can be minimized without interrupting work on the current page
- **QA-UX003**: The window uses the Query mascot avatar to identify AI replies
- **QA-UX004**: Can be opened with a keyboard shortcut (e.g. `Cmd+K`)

#### 8.2.2 Chat interface
- **QA-UX005**: The input box accepts free text, with no command syntax to learn
- **QA-UX006**: AI replies are presented as structured cards (tables, lists, summaries), not plain text
- **QA-UX007**: After a successful operation, provide a link straight to the matching page
- **QA-UX008**: Keep the conversation history within the same session
- **QA-UX009**: Support follow-up questions (e.g. "find 台灣布業's orders" → "which of them are unpaid?")

### 8.3 Functional requirements (by MCP tool)

#### 8.3.1 Product lookup
- **QA-F101**: Search the product catalog by keyword (name, color)
  - Examples: "Are there any blue products?", "List all available fabrics"
- **QA-F102**: Look up a single product's full specification
  - Example: "Tell me the details of cotton-linen XL"

#### 8.3.2 Inventory lookup
- **QA-F201**: Look up product stock (by grade A/B/C/D and defective)
  - Example: "How much cotton-linen is in stock now? How many rolls per grade?"
- **QA-F202**: Get the low-stock alert list
  - Examples: "Which products need restocking?", "What are the stock alerts?"

#### 8.3.3 Customer management
- **QA-F301**: Search and look up customer data
  - Examples: "Find 台灣布業's contact details", "List all customers"
- **QA-F302**: Look up a single customer's full data
  - Example: "What's 台灣布業's address and who's the contact?"
- **QA-F303**: Add a customer
  - Example: "Add a customer, company 正大紡織, contact 陳大明, mobile 0912345678"

#### 8.3.4 Order management
- **QA-F401**: List orders (filter by status, payment status, customer)
  - Examples: "Which orders are unpaid?", "Status of 台灣布業's recent orders"
- **QA-F402**: Look up an order's full details
  - Example: "What are the lines and shipping status of order ORD-001?"
- **QA-F403**: Create a new sales order
  - Example: "Create a new order for 台灣布業, note: urgent"
- **QA-F404**: Update order status
  - Examples: "Mark ORD-001 as confirmed", "ORD-002 is paid in full"

#### 8.3.5 Purchase order management
- **QA-F501**: List purchase orders (filter by status, factory)
  - Example: "Which purchase orders are still in production?"
- **QA-F502**: Look up a purchase order's full details
  - Example: "What are the lines and expected arrival date of PO-2026001?"

#### 8.3.6 Shipping management
- **QA-F601**: Look up shipping records (filter by order, customer)
  - Example: "What did we ship to 台灣布業 this month?"
- **QA-F602**: Look up a shipping's full details (including roll numbers)
  - Example: "Which rolls went out on shipping SH-001?"

#### 8.3.7 Factory management
- **QA-F701**: Search and look up factory data
  - Examples: "Which factories do we work with?", "Find 正豐工廠's contact details"

### 8.4 Technical requirements

#### 8.4.1 Architecture
- **QA-T001**: The frontend gets the user's JWT from Supabase Auth and uses it to authenticate with the Query API
- **QA-T002**: The Query backend calls the MCP Server (`https://qerp-system-production.up.railway.app/mcp`), passing the user's JWT
- **QA-T003**: The MCP Server accesses Supabase with the user's JWT, so RLS ensures data isolation automatically
- **QA-T004**: The AI reasoning layer uses the Claude API (suggested: claude-sonnet-4-6) with MCP tool use

#### 8.4.2 Security
- **QA-T005**: The JWT must not be stored in localStorage; use the Supabase session
- **QA-T006**: The MCP Server verifies the JWT on every request
- **QA-T007**: Query can only access data of the user's own organizations (enforced by RLS)

#### 8.4.3 Performance
- **QA-T008**: Time to first response < 3 seconds
- **QA-T009**: Tool call (MCP tool call) response time < 1 second

### 8.5 Data flow

```
User types natural language
        ↓
Frontend Query window (with Supabase JWT)
        ↓
Claude API (claude-sonnet-4-6)
        ↓ tool_use
MCP Server (Railway)
  Authorization: Bearer <user-jwt>
        ↓
Supabase RLS (isolates organization data automatically)
        ↓
Structured results returned → Claude composes the reply
        ↓
User sees a natural-language reply + structured cards
```

### 8.6 Out of scope for this version
- Voice input
- Proactive push notifications (e.g. automatic stock alerts)
- Batch operations (e.g. creating several orders at once)
- Exporting reports

---

## 9. Future roadmap

### 9.1 Short term (1–3 months)
- Complete the multi-tenant organization architecture
- Implement core business process management
- Build the basic permission management system
- Complete the basic UI/UX design

### 9.2 Medium term (3–6 months)
- Add advanced reports and analytics
- Add mobile support
- Add third-party system integration
- Optimize performance and scalability

### 9.3 Long term (6–12 months)
- AI-driven inventory forecasting
- Supply chain optimization suggestions
- Advanced business intelligence
- Internationalization and multi-language support

## 10. Success metrics

### 10.1 Business metrics
- User activity > 80%
- System adoption > 90%
- User satisfaction > 4.5/5
- Business process efficiency gain > 30%

### 10.2 Technical metrics
- System availability > 99.5%
- Average response time < 500ms
- Error rate < 0.1%
- Code coverage > 80%

### 10.3 Organization management metrics
- Organization creation success rate > 95%
- Permission setting accuracy > 99%
- Data isolation integrity 100%
- Multi-tenant concurrency stability > 99%

---

**Document version**: 3.0  
**Last updated**: 2026-04-16  
**Owner**: Product team  
**Review cycle**: Weekly
