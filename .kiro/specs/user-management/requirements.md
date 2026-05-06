# Requirements Document

## Introduction

This feature implements a comprehensive User Management screen in the VisioFab WMS web frontend. Administrators will be able to list, create, edit, deactivate, and manage permissions for system users. The screen also supports linking users to funcionários for mobile app (coletor) access. The backend already provides basic CRUD endpoints (`/api/usuarios`, `/api/auth/registrar`) and the data model includes `Usuario`, `UsuarioEmpresa`, and `Funcionario` entities.

## Glossary

- **Sistema**: The VisioFab WMS web application (frontend + backend)
- **Tela_Usuarios**: The User Management page located at `/configurador/usuarios`
- **Usuario**: A registered user entity with id, nome, email, senha, perfil, status, criadoEm, atualizadoEm
- **Perfil**: The user's role, one of ADMIN, SUPERVISOR, or OPERADOR
- **Modulos**: Access modules available in the system: WMS, COMPRAS, VENDAS, FINANCEIRO, FISCAL (stored as comma-separated string or "*" for all)
- **UsuarioEmpresa**: Junction table linking a Usuario to an Empresa with associated module permissions
- **Funcionario**: An employee entity that can be linked to a Usuario via the `usuarioId` field for coletor access
- **Coletor**: The mobile application used by warehouse operators; requires a linked Funcionario
- **Administrador**: A user with ADMIN perfil who has access to the Tela_Usuarios
- **Soft_Delete**: Deactivation of a user by setting status to false instead of removing the database record

---

## Requirements

### Requirement 1: List Users

**User Story:** As an Administrador, I want to see all registered users in a table, so that I can quickly review who has access to the system and their current configuration.

#### Acceptance Criteria

1. WHEN the Administrador navigates to the Tela_Usuarios, THE Sistema SHALL display a paginated table of all Usuario records ordered by creation date.
2. THE Tela_Usuarios SHALL display the following columns for each Usuario: nome, email, perfil, status (Ativo/Inativo), and coletor access indicator.
3. WHEN a Usuario is linked to a Funcionario, THE Tela_Usuarios SHALL display the linked Funcionario nome in the coletor column.
4. WHEN the Administrador types in the search field, THE Sistema SHALL filter the user list by nome or email containing the search term (case-insensitive).
5. WHILE the user list is loading, THE Tela_Usuarios SHALL display a loading indicator overlay.
6. WHEN no users match the current filter, THE Tela_Usuarios SHALL display an empty state message "Nenhum registro encontrado".

---

### Requirement 2: Create User

**User Story:** As an Administrador, I want to register new users with their profile and credentials, so that I can grant system access to new team members.

#### Acceptance Criteria

1. WHEN the Administrador clicks the "Novo" button, THE Tela_Usuarios SHALL open a creation modal with fields: nome, email, senha, perfil (select), and funcionario link (optional select).
2. THE Sistema SHALL validate that nome has at least 3 characters, email is a valid email format, and senha has at least 6 characters.
3. WHEN the Administrador submits a valid creation form, THE Sistema SHALL create a new Usuario with the provided data and a hashed password.
4. IF the provided email already exists in the database, THEN THE Sistema SHALL display an error notification "Email já cadastrado".
5. WHEN the Administrador selects a Funcionario in the creation form, THE Sistema SHALL link the new Usuario to that Funcionario by setting the Funcionario's usuarioId field.
6. WHEN a new Usuario is created successfully, THE Tela_Usuarios SHALL close the modal, display a success notification, and refresh the user list.

---

### Requirement 3: Edit User

**User Story:** As an Administrador, I want to edit existing user details, so that I can update profiles, reset passwords, and manage user access as needs change.

#### Acceptance Criteria

1. WHEN the Administrador clicks the edit action on a Usuario row, THE Tela_Usuarios SHALL open an edit modal pre-filled with the current nome, email (read-only), perfil, status, and linked Funcionario.
2. THE Sistema SHALL allow the Administrador to modify: nome, perfil, and status fields.
3. WHEN the Administrador provides a new password in the edit form, THE Sistema SHALL update the Usuario senha with the new hashed value.
4. WHEN the Administrador leaves the password field empty in the edit form, THE Sistema SHALL retain the existing senha unchanged.
5. WHEN the Administrador submits a valid edit form, THE Sistema SHALL update the Usuario record and display a success notification.
6. IF the update request fails, THEN THE Sistema SHALL display an error notification with the failure reason.

---

### Requirement 4: Manage Module Permissions

**User Story:** As an Administrador, I want to configure which modules each user can access, so that I can enforce least-privilege access control.

#### Acceptance Criteria

1. THE Tela_Usuarios SHALL provide a permissions section (within the edit modal or as a separate action) displaying checkboxes for each available module: WMS, COMPRAS, VENDAS, FINANCEIRO, FISCAL.
2. WHEN the Administrador checks or unchecks module checkboxes, THE Sistema SHALL update the UsuarioEmpresa modulos field with the comma-separated list of selected modules.
3. WHEN all modules are selected, THE Sistema SHALL store the modulos value as "*" to represent full access.
4. WHEN no modules are selected, THE Sistema SHALL store an empty modulos value and display a warning "Usuário ficará sem acesso a módulos".
5. THE Sistema SHALL load and display the current module permissions when opening the permissions section for a Usuario.

---

### Requirement 5: Coletor Access Management

**User Story:** As an Administrador, I want to toggle mobile app (coletor) access for users, so that warehouse operators can use the handheld device application.

#### Acceptance Criteria

1. THE Tela_Usuarios SHALL display a toggle or switch for coletor access in the user edit form.
2. WHEN the Administrador enables coletor access, THE Sistema SHALL require the selection of a Funcionario to link to the Usuario.
3. WHEN the Administrador enables coletor access and selects a Funcionario, THE Sistema SHALL set the Funcionario's usuarioId to the current Usuario id.
4. WHEN the Administrador disables coletor access, THE Sistema SHALL remove the link by setting the previously linked Funcionario's usuarioId to null.
5. WHILE coletor access is enabled for a Usuario, THE Tela_Usuarios SHALL display the linked Funcionario nome.
6. THE Sistema SHALL only list Funcionarios that are not already linked to another Usuario in the Funcionario selection dropdown.
7. IF the Administrador attempts to enable coletor access without selecting a Funcionario, THEN THE Sistema SHALL display a validation error "Selecione um funcionário para habilitar o acesso ao coletor".

---

### Requirement 6: Deactivate User (Soft Delete)

**User Story:** As an Administrador, I want to deactivate users instead of permanently deleting them, so that audit history is preserved and accounts can be reactivated if needed.

#### Acceptance Criteria

1. WHEN the Administrador clicks the delete/deactivate action on a Usuario row, THE Tela_Usuarios SHALL display a confirmation dialog with the message "Deseja desativar o usuário [nome]?".
2. WHEN the Administrador confirms the deactivation, THE Sistema SHALL set the Usuario status field to false (Soft_Delete).
3. THE Sistema SHALL NOT permanently remove the Usuario record from the database.
4. WHEN a Usuario is deactivated, THE Tela_Usuarios SHALL refresh the list showing the updated status as "Inativo".
5. WHEN the Administrador edits a deactivated Usuario and sets status to true, THE Sistema SHALL reactivate the Usuario account.
6. WHILE a Usuario has status false, THE Sistema SHALL reject login attempts for that Usuario with the message "Conta desativada. Contate o administrador".

---

### Requirement 7: Access Control

**User Story:** As a system owner, I want only administrators to access the user management screen, so that unauthorized users cannot modify access configurations.

#### Acceptance Criteria

1. THE Sistema SHALL restrict access to the Tela_Usuarios to users with perfil ADMIN.
2. IF a non-ADMIN user attempts to navigate to the Tela_Usuarios URL, THEN THE Sistema SHALL redirect the user to the dashboard and display a notification "Acesso não autorizado".
3. THE Sistema SHALL hide the "Usuários" menu item from the navigation for non-ADMIN users.
