import { redirect } from "next/navigation";

/** Публичная регистрация отключена — старые ссылки ведут на вход. */
export default function RegisterPage() {
  redirect("/login");
}
